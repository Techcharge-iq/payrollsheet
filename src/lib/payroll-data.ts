import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db as supabase, dbAny } from "@/integrations/supabase/external-client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import type { AdvanceTx, Employee, PayrollBatch, PayrollBatchStatus, PayrollLine } from "./payroll";
import { calculatePayroll, PAYROLL_CALCULATION_VERSION, PAYROLL_POLICY, toNum } from "./payroll";

export type TimesheetRecord = Tables<"timesheets">;
export type PayrollSiteAllocation = Tables<"payroll_site_allocations">;
type TimesheetInsert = TablesInsert<"timesheets">;

const TIMESHEET_FIELDS =
  "id, employee_id, site, foreman, work_date, status, in_time, out_time, break_hours, total_hours, regular_hours, overtime_hours, remarks, created_at";

export function useTimesheetsForDate(workDate: string) {
  return useQuery({
    queryKey: ["timesheets", "date", workDate],
    queryFn: async (): Promise<TimesheetRecord[]> => {
      const { data, error } = await supabase
        .from("timesheets")
        .select(TIMESHEET_FIELDS)
        .eq("work_date", workDate)
        .order("employee_id");
      if (error) throw error;
      return data ?? [];
    },
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(workDate),
  });
}

export function useTimesheetsForMonth(month: string) {
  return useQuery({
    queryKey: ["timesheets", "month", month],
    queryFn: async (): Promise<TimesheetRecord[]> => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Select a valid attendance month.");
      }

      const year = Number(month.slice(0, 4));
      const monthNumber = Number(month.slice(5, 7));
      const nextYear = monthNumber === 12 ? year + 1 : year;
      const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
      const startDate = `${month}-01`;
      const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
      const pageSize = 1000;
      const records: TimesheetRecord[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await supabase
          .from("timesheets")
          .select(TIMESHEET_FIELDS)
          .gte("work_date", startDate)
          .lt("work_date", endDate)
          .order("work_date", { ascending: true })
          .order("employee_id", { ascending: true })
          .range(start, start + pageSize - 1);
        if (error) throw error;
        records.push(...(data ?? []));
        if (!data || data.length < pageSize) return records;
      }
    },
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
}

export function usePayrollSiteAllocations(month: string, enabled = true) {
  return useQuery({
    queryKey: ["payroll_site_allocations", month],
    queryFn: async (): Promise<PayrollSiteAllocation[]> => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Select a valid payroll month for site allocation.");
      }
      const pageSize = 1000;
      const records: PayrollSiteAllocation[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await supabase
          .from("payroll_site_allocations")
          .select(
            "id, payroll_line_id, employee_id, month, site, foreman, regular_hours, overtime_hours, allocated_regular_pay, allocated_overtime_pay, allocated_allowances, allocated_gross_cost, allocation_basis, calculation_version, created_at",
          )
          .eq("month", month)
          .order("site")
          .order("foreman")
          .range(start, start + pageSize - 1);
        if (error) throw error;
        records.push(...(data ?? []));
        if (!data || data.length < pageSize) return records;
      }
    },
    enabled: enabled && /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
}

export function useSaveTimesheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: TimesheetInsert[]) => {
      if (!rows.length) throw new Error("Add at least one complete attendance entry.");
      const { error } = await supabase
        .from("timesheets")
        .upsert(rows, { onConflict: "employee_id,work_date" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, trade, id_number, hourly_rate, status")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((e) => ({
        ...e,
        hourly_rate: Number(e.hourly_rate),
      })) as Employee[];
    },
  });
}

export function useBatches(month?: string, enabled = true) {
  return useQuery({
    queryKey: ["payroll_batches", month ?? "all"],
    queryFn: async (): Promise<PayrollBatch[]> => {
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Select a valid payroll month.");
      }
      const pageSize = 1000;
      const batches: Tables<"payroll_batches">[] = [];
      const lines: Tables<"payroll_lines">[] = [];
      for (let start = 0; ; start += pageSize) {
        let batchQuery = supabase
          .from("payroll_batches")
          .select(
            "id, month, site, foreman, created_at, status, approved_by, approved_at, locked_by, locked_at, paid_by, paid_at",
          )
          .order("month", { ascending: false })
          .order("id");
        let lineQuery = supabase
          .from("payroll_lines")
          .select(
            "id, batch_id, employee_id, month, foreman, hours, rate, food_deduction, prev_advance, new_advance, other_deduction, net_salary, paid, created_at, calculation_version, regular_hours, overtime_hours, regular_pay, overtime_pay, allowances, gross_pay, deductions, advance_recovery, net_pay",
          )
          .order("month", { ascending: false })
          .order("id");
        if (month) {
          batchQuery = batchQuery.eq("month", month);
          lineQuery = lineQuery.eq("month", month);
        }
        const [
          { data: batchPage, error: batchError },
          { data: linePage, error: lineError },
        ] = await Promise.all([
          batchQuery.range(start, start + pageSize - 1),
          lineQuery.range(start, start + pageSize - 1),
        ]);
        if (batchError) throw batchError;
        if (lineError) throw lineError;
        batches.push(...(batchPage ?? []));
        lines.push(...(linePage ?? []));
        if (
          (!batchPage || batchPage.length < pageSize) &&
          (!linePage || linePage.length < pageSize)
        ) {
          break;
        }
      }
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
  });
}

export function usePayrollAdvanceBalancesBefore(month: string) {
  return useQuery({
    queryKey: ["payroll_advance_balance_before", month],
    queryFn: async (): Promise<Array<{ employee_id: number; balance: number }>> => {
      const { data, error } = await supabase.rpc("payroll_advance_balances_before", {
        target_month: month,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        employee_id: row.employee_id,
        balance: Number(row.balance),
      }));
    },
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
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
        const { error } = await supabase.from("employees").update(payload).eq("id", emp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employees").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useSaveBatch(canDelete = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batch: PayrollBatch) => {
      let batchId = batch.id;
      if (batchId) {
        const { error } = await supabase
          .from("payroll_batches")
          .update({ month: batch.month, site: batch.site, foreman: batch.foreman })
          .eq("id", batchId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("payroll_batches")
          .insert({ month: batch.month, site: batch.site, foreman: batch.foreman })
          .select("id")
          .single();
        if (error) throw error;
        batchId = data.id;
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
            policy: PAYROLL_POLICY,
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
        const { error } = await supabase.from("payroll_lines").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }

      if (batch.id && canDelete) {
        const retainedIds = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
        const removedIds = previousLineIds.filter((id) => !retainedIds.has(id));
        if (removedIds.length) {
          const { error } = await supabase.from("payroll_lines").delete().in("id", removedIds);
          if (error) throw error;
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
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
  });
}

export function useUpdateBatchMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, site, foreman }: { id: string; site: string; foreman: string }) => {
      const { error } = await supabase
        .from("payroll_batches")
        .update({ site, foreman })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
  });
}

export function useUpdateBatchStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PayrollBatchStatus }) => {
      const { error } = await supabase.from("payroll_batches").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
  });
}

export function useUpdateLineForeman() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, foreman }: { id: string; foreman: string }) => {
      const { error } = await supabase.from("payroll_lines").update({ foreman }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll_batches"] }),
  });
}

/* ---------------- Advance transactions ---------------- */

export function useAdvances() {
  return useQuery({
    queryKey: ["advance_transactions"],
    queryFn: async (): Promise<AdvanceTx[]> => {
      const pageSize = 1000;
      const records: AdvanceTx[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await dbAny
          .from("advance_transactions")
          .select("id, employee_id, date, amount, reason, payment_method, notes")
          .order("date", { ascending: false })
          .order("id", { ascending: false })
          .range(start, start + pageSize - 1);
        if (error) throw error;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        records.push(
          ...(data ?? []).map((a: any) => ({
            id: String(a.id),
            employee_id: Number(a.employee_id),
            date: a.date,
            amount: Number(a.amount),
            reason: a.reason ?? "",
            payment_method: a.payment_method ?? "Cash",
            notes: a.notes ?? "",
          })),
        );
        if (!data || data.length < pageSize) return records;
      }
    },
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
        const { error } = await dbAny.from("advance_transactions").update(payload).eq("id", tx.id);
        if (error) throw error;
      } else {
        const { error } = await dbAny.from("advance_transactions").insert(payload);
        if (error) throw error;
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
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advance_transactions"] }),
  });
}
