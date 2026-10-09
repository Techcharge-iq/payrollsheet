import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BriefcaseBusiness,
  CalendarHeart,
  Check,
  Clock3,
  Plus,
  X,
} from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { dbAny } from "@/integrations/supabase/external-client";
import { btnGold, btnOutline, btnPrimary, card, input, select } from "./ui";

interface SalaryRecord {
  id: string;
  employee_id: number;
  hourly_rate: number;
  effective_on: string;
  created_at: string;
}
interface Assignment {
  id: string;
  employee_id: number;
  site: string;
  foreman: string;
  effective_from: string;
  effective_to: string | null;
}
interface Transfer {
  id: string;
  employee_id: number;
  from_site: string | null;
  to_site: string;
  to_foreman: string;
  effective_on: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}
interface LeaveType {
  id: string;
  name: string;
  annual_entitlement_days: number | null;
  payroll_treatment: "PAID" | "UNPAID" | "MANUAL";
  active: boolean;
}
interface LeaveRequest {
  id: string;
  employee_id: number;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  requested_days: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function WorkforceTab({
  employees,
  role,
  notify,
}: {
  employees: Employee[];
  role: string;
  notify: (message: string, tone?: "ok" | "warn") => void;
}) {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState(today);
  const [site, setSite] = useState("");
  const [foreman, setForeman] = useState("");
  const [transferDate, setTransferDate] = useState(today);
  const [transferReason, setTransferReason] = useState("");
  const [leaveTypeName, setLeaveTypeName] = useState("");
  const [leaveEntitlement, setLeaveEntitlement] = useState("");
  const [leaveTreatment, setLeaveTreatment] = useState<LeaveType["payroll_treatment"]>("MANUAL");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [leaveStart, setLeaveStart] = useState(today);
  const [leaveEnd, setLeaveEnd] = useState(today);
  const [leaveDays, setLeaveDays] = useState("1");
  const [leaveReason, setLeaveReason] = useState("");
  const [overtimeMultiplier, setOvertimeMultiplier] = useState("");
  const isAdmin = role === "admin";

  const salaries = useQuery({
    queryKey: ["employee_salary_history"],
    queryFn: async () => {
      const { data, error } = await dbAny
        .from("employee_salary_history")
        .select("*")
        .order("effective_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SalaryRecord[];
    },
  });
  const payrollSettings = useQuery({
    queryKey: ["payroll_settings"],
    queryFn: async () => {
      const { data, error } = await dbAny
        .from("payroll_settings")
        .select("overtime_multiplier")
        .eq("singleton", true)
        .single();
      if (error) throw error;
      return data as { overtime_multiplier: number | null };
    },
  });
  const assignments = useQuery({
    queryKey: ["employee_site_assignments"],
    queryFn: async () => {
      const { data, error } = await dbAny
        .from("employee_site_assignments")
        .select("*")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });
  const transfers = useQuery({
    queryKey: ["employee_transfer_requests"],
    queryFn: async () => {
      const { data, error } = await dbAny
        .from("employee_transfer_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Transfer[];
    },
  });
  const leaveTypes = useQuery({
    queryKey: ["leave_types"],
    queryFn: async () => {
      const { data, error } = await dbAny.from("leave_types").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as LeaveType[];
    },
  });
  const leaveRequests = useQuery({
    queryKey: ["leave_requests"],
    queryFn: async () => {
      const { data, error } = await dbAny
        .from("leave_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRequest[];
    },
  });

  const refresh = async (...keys: string[]) =>
    Promise.all(keys.map((key) => qc.invalidateQueries({ queryKey: [key] })));
  const saveRate = useMutation({
    mutationFn: async () => {
      if (!employeeId || !rate || Number(rate) < 0 || !rateDate)
        throw new Error("Choose an employee, a non-negative rate, and an effective date.");
      const id = Number(employeeId);
      const amount = Number(rate);
      if (rateDate === today()) {
        const { error } = await dbAny
          .from("employees")
          .update({ hourly_rate: amount })
          .eq("id", id);
        if (error) throw error;
        await qc.invalidateQueries({ queryKey: ["employees"] });
      } else {
        const { error } = await dbAny
          .from("employee_salary_history")
          .insert({ employee_id: id, hourly_rate: amount, effective_on: rateDate });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void refresh("employee_salary_history");
      notify("Salary rate history saved.");
    },
    onError: (e) => notify(e.message, "warn"),
  });
  const savePayrollSettings = useMutation({
    mutationFn: async () => {
      const parsed = overtimeMultiplier.trim() ? Number(overtimeMultiplier) : null;
      if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0))
        throw new Error(
          "Overtime multiplier must be greater than zero, or blank to disable overtime payroll.",
        );
      const { error } = await dbAny
        .from("payroll_settings")
        .update({ overtime_multiplier: parsed })
        .eq("singleton", true);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_settings"] });
      setOvertimeMultiplier("");
      notify(
        "Overtime payroll setting saved. New payroll calculations will snapshot this multiplier.",
      );
    },
    onError: (e) => notify(e.message, "warn"),
  });
  const saveTransfer = useMutation({
    mutationFn: async () => {
      if (!employeeId || !site.trim() || !transferDate)
        throw new Error("Choose an employee, destination site, and effective date.");
      const current = (assignments.data ?? []).find(
        (a) => a.employee_id === Number(employeeId) && !a.effective_to,
      );
      const { error } = await dbAny.from("employee_transfer_requests").insert({
        employee_id: Number(employeeId),
        from_site: current?.site ?? null,
        to_site: site.trim(),
        to_foreman: foreman.trim(),
        effective_on: transferDate,
        reason: transferReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void refresh("employee_transfer_requests");
      setSite("");
      setForeman("");
      setTransferReason("");
      notify("Transfer request submitted for review.");
    },
    onError: (e) => notify(e.message, "warn"),
  });
  const reviewTransfer = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) => {
      const { error } = await dbAny
        .from("employee_transfer_requests")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void refresh("employee_transfer_requests", "employee_site_assignments");
      notify("Transfer request reviewed.");
    },
    onError: (e) => notify(e.message, "warn"),
  });
  const saveLeaveType = useMutation({
    mutationFn: async () => {
      if (!leaveTypeName.trim()) throw new Error("Enter a leave type name.");
      const { error } = await dbAny.from("leave_types").insert({
        name: leaveTypeName.trim(),
        annual_entitlement_days: leaveEntitlement ? Number(leaveEntitlement) : null,
        payroll_treatment: leaveTreatment,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void refresh("leave_types");
      setLeaveTypeName("");
      setLeaveEntitlement("");
      notify("Leave type added.");
    },
    onError: (e) => notify(e.message, "warn"),
  });
  const submitLeave = useMutation({
    mutationFn: async () => {
      if (!employeeId || !leaveTypeId || !leaveStart || !leaveEnd || Number(leaveDays) <= 0)
        throw new Error("Complete the employee, leave type, dates, and day count.");
      const { error } = await dbAny.from("leave_requests").insert({
        employee_id: Number(employeeId),
        leave_type_id: leaveTypeId,
        start_date: leaveStart,
        end_date: leaveEnd,
        requested_days: Number(leaveDays),
        reason: leaveReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void refresh("leave_requests");
      setLeaveReason("");
      notify("Leave request submitted.");
    },
    onError: (e) => notify(e.message, "warn"),
  });
  const reviewLeave = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) => {
      const { error } = await dbAny.from("leave_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void refresh("leave_requests");
      notify("Leave request reviewed.");
    },
    onError: (e) => notify(e.message, "warn"),
  });

  const currentAssignment = useMemo(
    () => (assignments.data ?? []).filter((a) => !a.effective_to),
    [assignments.data],
  );
  const selectedEmployee = employees.find((e) => String(e.id) === employeeId);
  const approvedDays = useMemo(() => {
    const totals = new Map<string, number>();
    (leaveRequests.data ?? [])
      .filter((r) => r.status === "APPROVED")
      .forEach((r) => {
        const key = `${r.employee_id}:${r.leave_type_id}:${r.start_date.slice(0, 4)}`;
        totals.set(key, (totals.get(key) ?? 0) + Number(r.requested_days));
      });
    return totals;
  }, [leaveRequests.data]);
  const recordError =
    salaries.error ??
    assignments.error ??
    transfers.error ??
    leaveTypes.error ??
    leaveRequests.error;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BriefcaseBusiness className="text-gold-dark" />
        <div>
          <h2 className="font-display text-xl font-extrabold text-navy">
            Workforce, Transfers & Leave
          </h2>
          <p className="text-sm text-muted-foreground">
            Effective-dated pay and site records. Older values stay unknown unless they were
            recorded.
          </p>
        </div>
      </div>
      {recordError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          Could not load workforce records: {recordError.message}
        </div>
      )}
      <section className={card + " space-y-3 p-4"}>
        <h3 className="font-bold text-navy">Payroll policy</h3>
        <p className="text-sm text-muted-foreground">
          Overtime multiplier: {payrollSettings.data?.overtime_multiplier ?? "Not configured"}.
          Existing saved lines retain their multiplier snapshot.
        </p>
        {isAdmin && (
          <div className="flex flex-wrap gap-3">
            <input
              className={input}
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Multiplier (e.g. 1.5)"
              value={overtimeMultiplier}
              onChange={(e) => setOvertimeMultiplier(e.target.value)}
            />
            <button
              className={btnGold}
              disabled={savePayrollSettings.isPending}
              onClick={() => savePayrollSettings.mutate()}
            >
              Save multiplier
            </button>
            <button
              className={btnOutline}
              disabled={savePayrollSettings.isPending}
              onClick={() => {
                setOvertimeMultiplier("");
                savePayrollSettings.mutate();
              }}
            >
              Disable overtime
            </button>
          </div>
        )}
      </section>
      <section className={card + " space-y-4 p-4"}>
        <h3 className="flex items-center gap-2 font-bold text-navy">
          <Clock3 size={17} />
          Salary rate history
        </h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <select
            className={select}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.trade}
              </option>
            ))}
          </select>
          <input
            className={input}
            type="number"
            min="0"
            step="0.001"
            placeholder="Hourly rate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <input
            className={input}
            type="date"
            value={rateDate}
            onChange={(e) => setRateDate(e.target.value)}
          />
          <button
            className={btnGold}
            disabled={saveRate.isPending}
            onClick={() => saveRate.mutate()}
          >
            <Plus size={15} />
            Record rate
          </button>
        </div>
        <div className="max-h-56 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-navy-soft">
              <tr>
                <th className="p-2">Employee</th>
                <th className="p-2">Effective from</th>
                <th className="p-2 text-right">OMR / hour</th>
                <th className="p-2">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {(salaries.data ?? []).map((r) => (
                <tr className="border-t border-border" key={r.id}>
                  <td className="p-2">
                    {employees.find((e) => e.id === r.employee_id)?.name ??
                      `Employee ${r.employee_id}`}
                  </td>
                  <td className="p-2">{r.effective_on}</td>
                  <td className="p-2 text-right">{Number(r.hourly_rate).toFixed(3)}</td>
                  <td className="p-2">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {!salaries.data?.length && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={4}>
                    No rate changes recorded yet. Existing historical rates are not inferred.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className={card + " space-y-4 p-4"}>
        <h3 className="flex items-center gap-2 font-bold text-navy">
          <ArrowLeftRight size={17} />
          Site assignments & transfer requests
        </h3>
        <p className="text-xs text-muted-foreground">
          Current recorded assignment:{" "}
          {selectedEmployee
            ? (currentAssignment.find((a) => a.employee_id === selectedEmployee.id)?.site ??
              "Unknown")
            : "Select an employee above"}
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            className={input}
            placeholder="Destination site"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          />
          <input
            className={input}
            placeholder="Foreman"
            value={foreman}
            onChange={(e) => setForeman(e.target.value)}
          />
          <input
            className={input}
            type="date"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
          />
          <button
            className={btnOutline}
            disabled={saveTransfer.isPending}
            onClick={() => saveTransfer.mutate()}
          >
            <Plus size={15} />
            Request transfer
          </button>
          <input
            className={input + " sm:col-span-4"}
            placeholder="Reason (optional)"
            value={transferReason}
            onChange={(e) => setTransferReason(e.target.value)}
          />
        </div>
        <div className="max-h-56 space-y-2 overflow-auto">
          {(transfers.data ?? []).map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-xs"
            >
              <b className="text-navy">
                {employees.find((e) => e.id === r.employee_id)?.name ?? `Employee ${r.employee_id}`}
              </b>
              <span>
                {r.from_site || "Unknown"} → {r.to_site}
              </span>
              <span>{r.effective_on}</span>
              <span className="font-bold">{r.status}</span>
              {isAdmin && r.status === "PENDING" && (
                <>
                  <button
                    className={btnOutline}
                    onClick={() => reviewTransfer.mutate({ id: r.id, status: "APPROVED" })}
                  >
                    <Check size={14} />
                    Approve
                  </button>
                  <button
                    className={btnOutline}
                    onClick={() => reviewTransfer.mutate({ id: r.id, status: "REJECTED" })}
                  >
                    <X size={14} />
                    Reject
                  </button>
                </>
              )}
            </div>
          ))}
          {!transfers.data?.length && (
            <p className="text-xs text-muted-foreground">No transfer requests yet.</p>
          )}
        </div>
        <div className="max-h-48 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-navy-soft">
              <tr>
                <th className="p-2">Employee</th>
                <th className="p-2">Site</th>
                <th className="p-2">Foreman</th>
                <th className="p-2">From</th>
                <th className="p-2">To</th>
              </tr>
            </thead>
            <tbody>
              {(assignments.data ?? []).map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="p-2">
                    {employees.find((e) => e.id === a.employee_id)?.name ??
                      `Employee ${a.employee_id}`}
                  </td>
                  <td className="p-2">{a.site}</td>
                  <td className="p-2">{a.foreman || "—"}</td>
                  <td className="p-2">{a.effective_from}</td>
                  <td className="p-2">{a.effective_to ?? "Current"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={card + " space-y-4 p-4"}>
        <h3 className="flex items-center gap-2 font-bold text-navy">
          <CalendarHeart size={17} />
          Leave tracking
        </h3>
        <p className="rounded-lg bg-gold/10 p-3 text-xs text-warn">
          Leave is recorded and approved here. Payroll treatment is manual per batch; approval does
          not silently alter wages.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            className={input}
            placeholder="New leave type"
            value={leaveTypeName}
            onChange={(e) => setLeaveTypeName(e.target.value)}
          />
          <input
            className={input}
            type="number"
            min="0"
            step="0.5"
            placeholder="Annual days (optional)"
            value={leaveEntitlement}
            onChange={(e) => setLeaveEntitlement(e.target.value)}
          />
          <select
            className={select}
            value={leaveTreatment}
            onChange={(e) => setLeaveTreatment(e.target.value as LeaveType["payroll_treatment"])}
          >
            <option value="MANUAL">Manual per payroll batch</option>
          </select>
          <button
            className={btnOutline}
            disabled={saveLeaveType.isPending}
            onClick={() => saveLeaveType.mutate()}
          >
            <Plus size={15} />
            Add leave type
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <select
            className={select}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <select
            className={select}
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
          >
            <option value="">Leave type</option>
            {(leaveTypes.data ?? [])
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.payroll_treatment}
                </option>
              ))}
          </select>
          <input
            className={input}
            type="date"
            value={leaveStart}
            onChange={(e) => setLeaveStart(e.target.value)}
          />
          <input
            className={input}
            type="date"
            value={leaveEnd}
            onChange={(e) => setLeaveEnd(e.target.value)}
          />
          <input
            className={input}
            type="number"
            min="0.5"
            step="0.5"
            placeholder="Days"
            value={leaveDays}
            onChange={(e) => setLeaveDays(e.target.value)}
          />
          <input
            className={input + " sm:col-span-2"}
            placeholder="Reason"
            value={leaveReason}
            onChange={(e) => setLeaveReason(e.target.value)}
          />
          <button
            className={btnGold}
            disabled={submitLeave.isPending}
            onClick={() => submitLeave.mutate()}
          >
            <Plus size={15} />
            Submit leave
          </button>
        </div>
        <div className="max-h-60 space-y-2 overflow-auto">
          {(leaveRequests.data ?? []).map((r) => {
            const type = leaveTypes.data?.find((t) => t.id === r.leave_type_id);
            const key = `${r.employee_id}:${r.leave_type_id}:${r.start_date.slice(0, 4)}`;
            const used = approvedDays.get(key) ?? 0;
            const remaining =
              type?.annual_entitlement_days == null
                ? null
                : Math.max(0, Number(type.annual_entitlement_days) - used);
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-xs"
              >
                <b className="text-navy">
                  {employees.find((e) => e.id === r.employee_id)?.name ??
                    `Employee ${r.employee_id}`}
                </b>
                <span>{type?.name ?? "Leave"}</span>
                <span>
                  {r.start_date} → {r.end_date} · {r.requested_days} day(s)
                </span>
                <span>
                  {remaining == null ? "Balance not configured" : `${remaining} day(s) remaining`}
                </span>
                <span className="font-bold">{r.status}</span>
                {isAdmin && r.status === "PENDING" && (
                  <>
                    <button
                      className={btnOutline}
                      onClick={() => reviewLeave.mutate({ id: r.id, status: "APPROVED" })}
                    >
                      <Check size={14} />
                      Approve
                    </button>
                    <button
                      className={btnOutline}
                      onClick={() => reviewLeave.mutate({ id: r.id, status: "REJECTED" })}
                    >
                      <X size={14} />
                      Reject
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {!leaveRequests.data?.length && (
            <p className="text-xs text-muted-foreground">No leave requests yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
