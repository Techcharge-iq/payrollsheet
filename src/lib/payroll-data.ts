import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db as supabase, dbAny } from "@/integrations/supabase/external-client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
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
      return rows
        .filter((row) => row.month === month)
        .sort((a, b) => a.site.localeCompare(b.site) || a.foreman.localeCompare(b.foreman));
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
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
          rate_segments: (l.rate_segments ?? null) as PayrollLine["rate_segments"],
        };
        (byBatch[l.batch_id] ??= []).push(line);
      });
      return batches.map((b) => ({
        id: b.id,
        month: b.month,
        site: b.site ?? "",
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

function isMissingPayrollSettingsError(error: { code?: string; message?: string; status?: number } | null) {
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
      const currentOvertimeMultiplier = (policyRow as { overtime_multiplier: number | null } | null)
        ?.overtime_multiplier ?? null;
      let batchId = batch.id;
      if (batchId) {
        const { data, error } = await supabase
          .from("payroll_batches")
          .update({ month: batch.month, site: batch.site, foreman: batch.foreman })
          .eq("id", batchId)
          .select("*")
          .single();
        if (error) throw error;
        await writeCachedRows("payroll_batches", [data]);
      } else {
        const { data, error } = await supabase
          .from("payroll_batches")
          .insert({ month: batch.month, site: batch.site, foreman: batch.foreman })
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
          .upsert(rows, { onConflict: "id" })
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
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
