import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db as supabase, dbAny } from "@/integrations/supabase/external-client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import type { AdvanceTx, Employee, PayrollBatch, PayrollLine } from "./payroll";
import { toNum } from "./payroll";

export type TimesheetRecord = Tables<"timesheets">;
type TimesheetInsert = TablesInsert<"timesheets">;

export function useTimesheets() {
  return useQuery({
    queryKey: ["timesheets"],
    queryFn: async (): Promise<TimesheetRecord[]> => {
      const pageSize = 1000;
      const records: TimesheetRecord[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await supabase
          .from("timesheets")
          .select(
            "id, employee_id, site, foreman, work_date, in_time, out_time, break_hours, total_hours, created_at",
          )
          .order("work_date", { ascending: false })
          .range(start, start + pageSize - 1);
        if (error) throw error;
        records.push(...(data ?? []));
        if (!data || data.length < pageSize) return records;
      }
    },
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

export function useBatches() {
  return useQuery({
    queryKey: ["payroll_batches"],
    queryFn: async (): Promise<PayrollBatch[]> => {
      const [{ data: batches, error: be }, { data: lines, error: le }] = await Promise.all([
        supabase.from("payroll_batches").select("*").order("month", { ascending: false }),
        supabase.from("payroll_lines").select("*"),
      ]);
      if (be) throw be;
      if (le) throw le;
      const byBatch: Record<string, PayrollLine[]> = {};
      (lines ?? []).forEach((l) => {
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
        };
        (byBatch[l.batch_id] ??= []).push(line);
      });
      return (batches ?? []).map((b) => ({
        id: b.id,
        month: b.month,
        site: b.site ?? "",
        foreman: b.foreman ?? "",
        lines: byBatch[b.id] ?? [],
      }));
    },
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
        .map((l) => ({
          ...(l.id ? { id: l.id } : {}),
          batch_id: batchId,
          employee_id: Number(l.employee_id),
          month: batch.month,
          foreman: l.foreman || batch.foreman,
          hours: toNum(l.hours),
          rate: toNum(l.rate),
          food_deduction: toNum(l.food_deduction),
          prev_advance: toNum(l.prev_advance),
          new_advance: toNum(l.new_advance),
          other_deduction: toNum(l.other_deduction),
          net_salary: toNum(l.net_salary),
          paid: toNum(l.paid),
        }));

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
      const { data, error } = await dbAny
        .from("advance_transactions")
        .select("id, employee_id, date, amount, reason, payment_method, notes")
        .order("date", { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((a: any) => ({
        id: String(a.id),
        employee_id: Number(a.employee_id),
        date: a.date,
        amount: Number(a.amount),
        reason: a.reason ?? "",
        payment_method: a.payment_method ?? "Cash",
        notes: a.notes ?? "",
      }));
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
