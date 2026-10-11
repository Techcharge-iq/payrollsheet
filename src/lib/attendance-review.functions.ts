import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const modelReview = z.object({
  missingEmployeeIds: z.array(z.number().int().positive()).max(2000),
  unusualHours: z
    .array(
      z.object({
        employeeId: z.number().int().positive(),
        severity: z.enum(["review", "high"]),
        reason: z.string().trim().min(1).max(300),
      }),
    )
    .max(2000),
  summary: z.string().trim().min(1).max(500),
});

export const reviewDailyAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: profile, error: profileError } = await context.supabase
      .from("users")
      .select("role,is_active")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (profileError) {
      throw new Error(
        `Could not verify payroll access for attendance review: ${profileError.message}`,
      );
    }
    if (!profile?.is_active || !["admin", "hr", "manager"].includes(profile.role)) {
      throw new Error("Only active payroll managers, HR, or administrators can review attendance.");
    }

    const gatewayKey = process.env["AI_GATEWAY_API_KEY"];
    if (!gatewayKey) {
      throw new Error(
        "AI attendance review is not configured. Set the server-only AI_GATEWAY_API_KEY.",
      );
    }

    const [employeesResult, entriesResult] = await Promise.all([
      context.supabase.from("employees").select("id,name,status").eq("status", "Active"),
      context.supabase
        .from("timesheets")
        .select("employee_id,status,total_hours")
        .eq("work_date", data.workDate),
    ]);
    if (employeesResult.error) {
      throw new Error(
        `Could not load active employees for attendance review: ${employeesResult.error.message}`,
      );
    }
    if (entriesResult.error) {
      throw new Error(`Could not load saved attendance for review: ${entriesResult.error.message}`);
    }

    const employees = (employeesResult.data ?? []).map(({ id, name }) => ({ id, name }));
    const entries = (entriesResult.data ?? []).map((entry) => ({
      employeeId: entry.employee_id,
      status: entry.status,
      totalHours: Number(entry.total_hours),
    }));
    if (entries.some((entry) => !Number.isFinite(entry.totalHours))) {
      throw new Error(
        "Saved attendance contains invalid hour totals; correct those records before review.",
      );
    }
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const recordedIds = new Set(entries.map((entry) => entry.employeeId));
    const missingEmployees = employees.filter((employee) => !recordedIds.has(employee.id));
    const model = process.env["AI_GATEWAY_MODEL"] || "openai/gpt-4o-mini";
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Review one day of payroll attendance. Return only a JSON object with keys "missingEmployeeIds" (employee IDs from the roster with no record), "unusualHours" (array of {"employeeId": number, "severity": "review"|"high", "reason": string}), and "summary" (short string). Treat ABSENT, LEAVE, HOLIDAY, and WEEKLY_OFF as records, not missing. Flag only hour totals that merit human review; use high severity for implausible or exceptionally long totals. Do not infer or invent data.',
          },
          {
            role: "user",
            content: JSON.stringify({
              workDate: data.workDate,
              activeEmployees: employees,
              attendanceRecords: entries,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`AI Gateway attendance review failed (${response.status}): ${details}`);
    }

    const result: unknown = await response.json();
    const content =
      result && typeof result === "object" && "choices" in result
        ? (result as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
            ?.content
        : undefined;
    if (typeof content !== "string") {
      throw new Error("AI Gateway returned an invalid attendance review response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI Gateway returned attendance review data that was not valid JSON.");
    }
    const review = modelReview.parse(parsed);
    const allowedMissingIds = new Set(missingEmployees.map((employee) => employee.id));
    const modelMissingIds = new Set(
      review.missingEmployeeIds.filter((id) => allowedMissingIds.has(id)),
    );
    const missingIds = new Set([
      ...missingEmployees.map((employee) => employee.id),
      ...modelMissingIds,
    ]);
    const seenAnomalies = new Set<number>();
    const unusualHours = review.unusualHours.flatMap((item) => {
      if (
        !employeeById.has(item.employeeId) ||
        !recordedIds.has(item.employeeId) ||
        seenAnomalies.has(item.employeeId)
      ) {
        return [];
      }
      seenAnomalies.add(item.employeeId);
      return [
        {
          ...item,
          employeeName: employeeById.get(item.employeeId)!.name,
          totalHours: entries.find((entry) => entry.employeeId === item.employeeId)!.totalHours,
        },
      ];
    });

    return {
      workDate: data.workDate,
      summary: review.summary,
      missingEmployees: employees
        .filter((employee) => missingIds.has(employee.id))
        .map(({ id, name }) => ({ id, name })),
      unusualHours,
    };
  });
