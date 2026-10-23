import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db as supabase, dbAny } from "@/integrations/supabase/external-client";
import type { Tables, TablesInsert } from "@/integrations/supabase/external-types";
import type { AdvanceTx, Employee, PayrollBatch, PayrollBatchStatus, PayrollLine } from "./payroll";
import { calculatePayroll, PAYROLL_CALCULATION_VERSION, PAYROLL_POLICY, toNum } from "./payroll";
import { deleteCachedRows, readCachedRows, writeCachedRows } from "./payroll-cache";

export type TimesheetRecord = Tables<"timesheets">;
export type PayrollSiteAllocation = Tables<"payroll_site_allocations">;
type TimesheetInsert = TablesInsert<"timesheets">;

interface AdvanceTransactionRecord extends Record<string, unknown> {
  id: string | number;
  employee_id: string | number;
  date: string | null;
  amount: string | number;
  reason: string | null;
  payment_method: string | null;
  notes: string | null;
}

export function useTimesheetsForDate(workDate: string) {
  return useQuery({
    queryKey: ["timesheets", "date", workDate],
    queryFn: async (): Promise<TimesheetRecord[]> => {
      const rows = await readCachedRows<TimesheetRecord>("timesheets", { workDate });
      return rows
        .filter((row) => row.work_date === workDate)
        .sort((a, b) => a.employee_id - b.employee_id);
    },
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(workDate),
    staleTime: 60_000,
  });
}

export function useTimesheetsForMonth(month: string) {
  return useQuery({
    queryKey: ["timesheets", "month", month],
    queryFn: async (): Promise<TimesheetRecord[]> => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Select a valid attendance month.");
      }

      const rows = await readCachedRows<TimesheetRecord>("timesheets", { month });
      return rows
        .filter((row) => row.work_date.startsWith(`${month}-`))
        .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.employee_id - b.employee_id);
    },
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
    staleTime: 60_000,
  });
}

async function deriveFallbackAllocations(month: string): Promise<PayrollSiteAllocation[]> {
  const [batches, lines, timesheets] = await Promise.all([
    readCachedRows<Tables<"payroll_batches">>("payroll_batches", { month }),
    readCachedRows<Tables<"payroll_lines">>("payroll_lines", { month }),
    readCachedRows<TimesheetRecord>("timesheets", { month }),
  ]);

  const monthLines = lines.filter((line) => line.month === month);
  if (!monthLines.length) return [];

  const batchesById = new Map(batches.map((b) => [b.id, b]));
  const monthTimesheets = timesheets.filter((t) => t.work_date.startsWith(`${month}-`));

  const result: PayrollSiteAllocation[] = [];

  for (const line of monthLines) {
    const batch = batchesById.get(line.batch_id);
    const regularHours =
      line.regular_hours !== null && line.regular_hours !== undefined
        ? toNum(line.regular_hours)
        : Math.max(toNum(line.hours) - toNum(line.overtime_hours), 0);
    const overtimeHours = toNum(line.overtime_hours);
    const rate = toNum(line.rate);
    const regularPay =
      line.regular_pay !== null && line.regular_pay !== undefined
        ? toNum(line.regular_pay)
        : regularHours * rate;
    const overtimePay =
      line.overtime_pay !== null && line.overtime_pay !== undefined
        ? toNum(line.overtime_pay)
        : overtimeHours * rate;
    const allowances = toNum(line.allowances);
    const grossCost =
      line.gross_pay !== null && line.gross_pay !== undefined
        ? toNum(line.gross_pay)
        : regularPay + overtimePay + allowances;

    const empTimesheets = monthTimesheets.filter(
      (t) =>
        t.employee_id === line.employee_id &&
        (toNum(t.regular_hours) + toNum(t.overtime_hours) > 0 || toNum(t.total_hours) > 0),
    );

    if (empTimesheets.length > 0) {
      const siteBuckets = new Map<
        string,
        { site: string; foreman: string; regularHours: number; overtimeHours: number }
      >();
      let totalRegular = 0;
      let totalOvertime = 0;

      for (const t of empTimesheets) {
        const key = `${t.site}:::${t.foreman}`;
        const reg = toNum(t.regular_hours ?? t.total_hours);
        const ot = toNum(t.overtime_hours);
        const existing = siteBuckets.get(key) ?? {
          site: t.site,
          foreman: t.foreman,
          regularHours: 0,
          overtimeHours: 0,
        };
        existing.regularHours += reg;
        existing.overtimeHours += ot;
        siteBuckets.set(key, existing);
        totalRegular += reg;
        totalOvertime += ot;
      }

      const totalHours = totalRegular + totalOvertime;
      const buckets = Array.from(siteBuckets.values());
      let allocatedSoFar = 0;

      buckets.forEach((bucket, idx) => {
        const isLast = idx === buckets.length - 1;
        const regCost = totalRegular > 0 ? (regularPay * bucket.regularHours) / totalRegular : 0;
        const otCost = totalOvertime > 0 ? (overtimePay * bucket.overtimeHours) / totalOvertime : 0;
        const allowCost =
          totalHours > 0
            ? (allowances * (bucket.regularHours + bucket.overtimeHours)) / totalHours
            : 0;
        const gross = isLast
          ? Math.round((grossCost - allocatedSoFar) * 1000) / 1000
          : Math.round((regCost + otCost + allowCost) * 1000) / 1000;
        allocatedSoFar += gross;

        result.push({
          id: `derived-${line.id}-${idx}`,
          payroll_line_id: line.id,
          employee_id: line.employee_id,
          month: line.month,
          site: bucket.site || batch?.site?.trim() || "Unassigned",
          foreman: bucket.foreman || line.foreman?.trim() || batch?.foreman?.trim() || "Unassigned",
          project_id: batch?.project_id ?? null,
          regular_hours: Math.round(bucket.regularHours * 1000) / 1000,
          overtime_hours: Math.round(bucket.overtimeHours * 1000) / 1000,
          allocated_regular_pay: Math.round(regCost * 1000) / 1000,
          allocated_overtime_pay: Math.round(otCost * 1000) / 1000,
          allocated_allowances: Math.round(allowCost * 1000) / 1000,
          allocated_gross_cost: gross,
          allocation_basis: "ATTENDANCE_HOURS",
          calculation_version: line.calculation_version ?? null,
          created_at: line.created_at ?? new Date().toISOString(),
        });
      });
    } else {
      result.push({
        id: `fallback-${line.id}`,
        payroll_line_id: line.id,
        employee_id: line.employee_id,
        month: line.month,
        site: batch?.site?.trim() || "Unassigned",
        foreman: line.foreman?.trim() || batch?.foreman?.trim() || "Unassigned",
        project_id: batch?.project_id ?? null,
        regular_hours: regularHours,
        overtime_hours: overtimeHours,
        allocated_regular_pay: regularPay,
        allocated_overtime_pay: overtimePay,
        allocated_allowances: allowances,
        allocated_gross_cost: grossCost,
        allocation_basis: "LEGACY_ESTIMATED",
        calculation_version: line.calculation_version ?? null,
        created_at: line.created_at ?? new Date().toISOString(),
      });
    }
  }

  return result.sort(
    (a, b) => a.site.localeCompare(b.site) || a.foreman.localeCompare(b.foreman),
  );
}

export function usePayrollSiteAllocations(month: string, enabled = true) {
  return useQuery({
    queryKey: ["payroll_site_allocations", month],
    queryFn: async (): Promise<PayrollSiteAllocation[]> => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Select a valid payroll month for site allocation.");
      }
      const rows = await readCachedRows<PayrollSiteAllocation>("payroll_site_allocations", {
        month,
      });
      const filtered = rows.filter((row) => row.month === month);
      if (filtered.length > 0) {
        return filtered.sort(
          (a, b) => a.site.localeCompare(b.site) || a.foreman.localeCompare(b.foreman),
        );
      }
      return deriveFallbackAllocations(month);
    },
    enabled: enabled && /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
    staleTime: 60_000,
  });
}

export function useSaveTimesheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: TimesheetInsert[]) => {
      if (!rows.length) throw new Error("Add at least one complete attendance entry.");
      const { data, error } = await supabase
        .from("timesheets")
        .upsert(rows, { onConflict: "employee_id,work_date" })
        .select("*");
      if (error) throw error;
      await writeCachedRows("timesheets", data ?? []);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["timesheets"] });
      void qc.invalidateQueries({ queryKey: ["payroll_site_allocations"] });
    },
  });
}

export function useEmployees(enabled = true) {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<Employee[]> => {
      const data = await readCachedRows<Tables<"employees">>("employees");
      return data
        .map((e) => ({
          ...e,
          hourly_rate: Number(e.hourly_rate),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)) as Employee[];
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useBatches(month?: string, enabled = true) {
  return useQuery({
    queryKey: ["payroll_batches", month ?? "all"],
    queryFn: async (): Promise<PayrollBatch[]> => {
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Select a valid payroll month.");
      }
      const [allBatches, allLines] = await Promise.all([
        readCachedRows<Tables<"payroll_batches">>("payroll_batches", month ? { month } : {}),
        readCachedRows<Tables<"payroll_lines">>("payroll_lines", month ? { month } : {}),
      ]);
      const batches = allBatches;
      const lines = allLines;
      const byBatch: Record<string, PayrollLine[]> = {};
      lines.forEach((l) => {
        const line: PayrollLine = {
          id: l.id,
          batch_id: l.batch_id,
          employee_id: l.employee_id,
          foreman_user_id: l.foreman_user_id,
          foreman: l.foreman ?? "",
          hours: Number(l.hours),
          rate: Number(l.rate),
          food_deduction: Number(l.food_deduction),
          prev_advance: Number(l.prev_advance),
          new_advance: Number(l.new_advance),
          other_deduction: Number(l.other_deduction),
          net_salary: Number(l.net_salary),
          paid: Number(l.paid),
          calculation_version: l.calculation_version,
          regular_hours: l.regular_hours,
          overtime_hours: l.overtime_hours,
          regular_pay: l.regular_pay,
          overtime_pay: l.overtime_pay,
          allowances: l.allowances,
          gross_pay: l.gross_pay,
          deductions: l.deductions,
          advance_recovery: l.advance_recovery,
          net_pay: l.net_pay,
          rate_segments: ((l as { rate_segments?: unknown }).rate_segments ?? null) as PayrollLine["rate_segments"],
        };
        (byBatch[l.batch_id] ??= []).push(line);
      });
      return batches.map((b) => ({
        id: b.id,
        month: b.month,
        site: b.site ?? "",
        project_id: b.project_id,
        foreman_user_id: b.foreman_user_id,
        foreman: b.foreman ?? "",
        lines: byBatch[b.id] ?? [],
        status: b.status as PayrollBatchStatus,
        approved_by: b.approved_by,
        approved_at: b.approved_at,
        locked_by: b.locked_by,
        locked_at: b.locked_at,
        paid_by: b.paid_by,
        paid_at: b.paid_at,
      }));
    },
    enabled,
    staleTime: 60_000,
  });
}

export function usePayrollAdvanceBalancesBefore(month: string) {
  return useQuery({
    queryKey: ["payroll_advance_balance_before", month],
    queryFn: async (): Promise<Array<{ employee_id: number; balance: number }>> => {
      const lines = await readCachedRows<Tables<"payroll_lines">>("payroll_lines");
      const balances = new Map<number, number>();
      for (const line of lines) {
        if (line.month >= month) continue;
        balances.set(
          line.employee_id,
          (balances.get(line.employee_id) ?? 0) +
            Number(line.new_advance ?? 0) -
            Number(line.prev_advance ?? 0),
        );
      }
      return [...balances].map(([employee_id, amount]) => ({
        employee_id,
        balance: Math.max(0, Math.round(amount * 1000) / 1000),
      }));
    },
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
    staleTime: 60_000,
  });
}

export function useSaveEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (emp: Partial<Employee> & { id?: number }) => {
      const payload = {
        name: emp.name ?? "",
        trade: emp.trade ?? "HELPER",
        id_number: emp.id_number ?? "",
        hourly_rate: toNum(emp.hourly_rate),
        status: emp.status ?? "Active",
      };
      if (emp.id) {
        const { data, error } = await supabase
          .from("employees")
          .update(payload)
          .eq("id", emp.id)
          .select("*")
          .single();
        if (error) throw error;
        await writeCachedRows("employees", [data]);
      } else {
        const { data, error } = await supabase
          .from("employees")
          .insert(payload)
          .select("*")
          .single();
        if (error) throw error;
        await writeCachedRows("employees", [data]);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

function isMissingPayrollSettingsError(
  error: { code?: string; message?: string; status?: number } | null,
) {
  if (!error) return true;
  return (
    error.code === "PGRST116" ||
    error.code === "42P01" ||
    error.status === 404 ||
    /payroll_settings|does not exist|not found/i.test(error.message ?? "")
  );
}

export function useSaveBatch(canDelete = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batch: PayrollBatch) => {
      const { data: policyRow, error: policyError } = await dbAny
        .from("payroll_settings")
        .select("overtime_multiplier")
        .eq("singleton", true)
        .maybeSingle();
      if (policyError && !isMissingPayrollSettingsError(policyError)) throw policyError;
      const currentOvertimeMultiplier =
        (policyRow as { overtime_multiplier: number | null } | null)?.overtime_multiplier ?? null;
      let batchId = batch.id;
      if (batchId) {
        const { data, error } = await supabase
          .from("payroll_batches")
          .update({
            month: batch.month,
            site: batch.site,
            project_id: batch.project_id ?? null,
            foreman: batch.foreman,
            foreman_user_id: batch.foreman_user_id ?? null,
          })
          .eq("id", batchId)
          .select("*")
          .single();
        if (error) throw error;
        await writeCachedRows("payroll_batches", [data]);
      } else {
        const { data, error } = await supabase
          .from("payroll_batches")
          .insert({
            month: batch.month,
            site: batch.site,
            project_id: batch.project_id ?? null,
            foreman: batch.foreman,
            foreman_user_id: batch.foreman_user_id ?? null,
          })
          .select("*")
          .single();
        if (error) throw error;
        batchId = data.id;
        await writeCachedRows("payroll_batches", [data]);
      }
      const rows = batch.lines
        .filter((l) => l.employee_id)
        .map((l) => {
          const regularHours =
            l.regular_hours === undefined || l.regular_hours === null
              ? toNum(l.hours)
              : toNum(l.regular_hours);
          const overtimeHours = toNum(l.overtime_hours);
          const rate = toNum(l.rate);
          const calculation = calculatePayroll({
            regularHours,
            overtimeHours,
            rate,
            allowances: toNum(l.allowances),
            deductions: toNum(l.food_deduction) + toNum(l.other_deduction),
            advanceRecovery: toNum(l.prev_advance),
            rateSegments: l.rate_segments ?? undefined,
            policy: {
              ...PAYROLL_POLICY,
              overtimeMultiplier: l.overtime_multiplier ?? currentOvertimeMultiplier,
            },
          });

          return {
            ...(l.id ? { id: l.id } : {}),
            batch_id: batchId,
            employee_id: Number(l.employee_id),
            foreman_user_id: l.foreman_user_id ?? batch.foreman_user_id ?? null,
            month: batch.month,
            foreman: l.foreman || batch.foreman,
            hours: regularHours + overtimeHours,
            rate,
            food_deduction: toNum(l.food_deduction),
            prev_advance: toNum(l.prev_advance),
            new_advance: toNum(l.new_advance),
            other_deduction: toNum(l.other_deduction),
            net_salary: calculation.netPay,
            paid: toNum(l.paid),
            calculation_version: l.calculation_version ?? `${PAYROLL_CALCULATION_VERSION}-manual`,
            regular_hours: calculation.regularHours,
            overtime_hours: calculation.overtimeHours,
            regular_pay: calculation.regularPay,
            overtime_pay: calculation.overtimePay,
            allowances: calculation.allowances,
            gross_pay: calculation.grossPay,
            deductions: calculation.deductions,
            advance_recovery: calculation.advanceRecovery,
            net_pay: calculation.netPay,
            rate_segments: l.rate_segments ?? null,
            overtime_multiplier: l.overtime_multiplier ?? currentOvertimeMultiplier,
          };
        });

      let previousLineIds: string[] = [];
      if (batch.id && canDelete) {
        const { data, error } = await supabase
          .from("payroll_lines")
          .select("id")
          .eq("batch_id", batchId);
        if (error) throw error;
        previousLineIds = (data ?? []).map((line) => line.id);
      }

      if (rows.length) {
        const { data, error } = await supabase
          .from("payroll_lines")
          .upsert(rows as never, { onConflict: "id" })
          .select("*");
        if (error) throw error;
        await writeCachedRows("payroll_lines", data ?? []);
      }

      if (batch.id && canDelete) {
        const retainedIds = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
        const removedIds = previousLineIds.filter((id) => !retainedIds.has(id));
        if (removedIds.length) {
          const { error } = await supabase.from("payroll_lines").delete().in("id", removedIds);
          if (error) throw error;
          await deleteCachedRows("payroll_lines", removedIds);
        }
      }
      return batchId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_batches"] });
      void qc.invalidateQueries({ queryKey: ["payroll_site_allocations"] });
    },
  });
}

export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payroll_batches").delete().eq("id", id);
      if (error) throw error;
      const lines = await readCachedRows<Tables<"payroll_lines">>("payroll_lines");
      await deleteCachedRows(
        "payroll_lines",
        lines.filter((line) => line.batch_id === id).map((line) => line.id),
      );
      await deleteCachedRows("payroll_batches", [id]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_batches"] });
      void qc.invalidateQueries({ queryKey: ["payroll_site_allocations"] });
    },
  });
}

export function useUpdateBatchMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, site, foreman }: { id: string; site: string; foreman: string }) => {
      const { data, error } = await supabase
        .from("payroll_batches")
        .update({ site, foreman })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      await writeCachedRows("payroll_batches", [data]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_batches"] });
      void qc.invalidateQueries({ queryKey: ["payroll_site_allocations"] });
    },
  });
}

export function useUpdateBatchStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PayrollBatchStatus }) => {
      const { data, error } = await supabase
        .from("payroll_batches")
        .update({ status })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      await writeCachedRows("payroll_batches", [data]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_batches"] });
      void qc.invalidateQueries({ queryKey: ["payroll_site_allocations"] });
    },
  });
}

export function useUpdateLineForeman() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, foreman }: { id: string; foreman: string }) => {
      const { data, error } = await supabase
        .from("payroll_lines")
        .update({ foreman })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      await writeCachedRows("payroll_lines", [data]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_batches"] });
      void qc.invalidateQueries({ queryKey: ["payroll_site_allocations"] });
    },
  });
}

/* ---------------- Advance transactions ---------------- */

export function useAdvances(enabled = true) {
  return useQuery({
    queryKey: ["advance_transactions"],
    queryFn: async (): Promise<AdvanceTx[]> => {
      const data = await readCachedRows<AdvanceTransactionRecord>("advance_transactions");
      return data
        .map((a) => ({
          id: String(a.id),
          employee_id: Number(a.employee_id),
          date: a.date ?? "",
          amount: Number(a.amount),
          reason: a.reason ?? "",
          payment_method: a.payment_method ?? "Cash",
          notes: a.notes ?? "",
        }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Partial<AdvanceTx> & { id?: string }) => {
      const payload = {
        employee_id: Number(tx.employee_id),
        date: tx.date,
        amount: toNum(tx.amount),
        reason: tx.reason ?? "",
        payment_method: tx.payment_method ?? "Cash",
        notes: tx.notes ?? "",
      };
      if (tx.id) {
        const { data, error } = await dbAny
          .from("advance_transactions")
          .update(payload)
          .eq("id", tx.id)
          .select("*")
          .single();
        if (error) throw error;
        await writeCachedRows("advance_transactions", [data]);
      } else {
        const { data, error } = await dbAny
          .from("advance_transactions")
          .insert(payload)
          .select("*")
          .single();
        if (error) throw error;
        await writeCachedRows("advance_transactions", [data]);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advance_transactions"] }),
  });
}

export function useDeleteAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dbAny.from("advance_transactions").delete().eq("id", id);
      if (error) throw error;
      await deleteCachedRows("advance_transactions", [id]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advance_transactions"] }),
  });
}
