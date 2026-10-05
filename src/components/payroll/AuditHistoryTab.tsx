import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronLeft, ChevronRight, Clock3, Filter } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import { db } from "@/integrations/supabase/external-client";
import { btnOutline, card, select } from "./ui";

const PAGE_SIZE = 50;

const TABLE_LABELS: Record<string, string> = {
  advance_transactions: "Advance",
  employees: "Employee",
  payroll_site_allocations: "Payroll site allocation",
  payroll_batches: "Payroll batch",
  payroll_lines: "Payroll line",
  timesheets: "Attendance",
  users: "User access",
};

interface AuditRecord {
  actor_email: string | null;
  actor_id: string | null;
  changed_at: string;
  id: string;
  new_data: Json | null;
  old_data: Json | null;
  operation: string;
  record_id: string | null;
  table_name: string;
}

function asRecord(value: Json | null): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function displayValue(value: Json | undefined) {
  if (value === undefined) return "—";
  if (value === null || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function changedFields(entry: AuditRecord) {
  const before = asRecord(entry.old_data);
  const after = asRecord(entry.new_data);
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

function recordTitle(entry: AuditRecord) {
  const row = asRecord(entry.new_data ?? entry.old_data);
  const label = row["name"] ?? row["site"] ?? row["email"];
  if (label !== undefined && label !== null && label !== "") return String(label);
  return entry.record_id ? `Record ${entry.record_id.slice(0, 8)}` : "Record";
}

function operationStyle(operation: string) {
  if (operation === "INSERT") return "bg-emerald-50 text-emerald-700";
  if (operation === "DELETE") return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-800";
}

export function AuditHistoryTab() {
  const [page, setPage] = useState(0);
  const [tableFilter, setTableFilter] = useState("");
  const [operationFilter, setOperationFilter] = useState("");
  const query = useQuery({
    queryKey: ["admin-audit-logs", page, tableFilter, operationFilter],
    queryFn: async () => {
      let request = db
        .from("audit_logs")
        .select(
          "id, table_name, record_id, operation, actor_id, actor_email, old_data, new_data, changed_at",
          { count: "exact" },
        )
        .order("changed_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (tableFilter) request = request.eq("table_name", tableFilter);
      if (operationFilter) request = request.eq("operation", operationFilter);
      const { data, error, count } = await request;
      if (error) throw error;
      return { entries: data ?? [], count: count ?? 0 };
    },
  });

  const entryCount = query.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(entryCount / PAGE_SIZE));

  return (
    <section className="space-y-4">
      <div className={card + " flex flex-col gap-4 p-4 sm:flex-row sm:items-center"}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <Activity size={19} />
          </div>
          <div>
            <h2 className="font-display text-lg font-extrabold text-navy">Audit log</h2>
            <p className="text-xs text-muted-foreground">
              Payroll data changes, recorded with the acting account, exact time, and before/after
              values.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <label className="sr-only" htmlFor="audit-table-filter">
            Filter by data type
          </label>
          <select
            id="audit-table-filter"
            value={tableFilter}
            onChange={(event) => {
              setTableFilter(event.target.value);
              setPage(0);
            }}
            className={select + " min-w-40"}
          >
            <option value="">All data types</option>
            {Object.entries(TABLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="audit-operation-filter">
            Filter by change type
          </label>
          <select
            id="audit-operation-filter"
            value={operationFilter}
            onChange={(event) => {
              setOperationFilter(event.target.value);
              setPage(0);
            }}
            className={select + " min-w-36"}
          >
            <option value="">All changes</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
        </div>
      </div>

      {query.error && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Could not load audit history: {(query.error as Error).message}. Confirm that the audit
          migration has been applied to this Supabase project.
        </div>
      )}

      <div className={card + " overflow-hidden"}>
        {query.isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-lg bg-navy-soft" />
            ))}
          </div>
        ) : query.data?.entries.length ? (
          <div className="divide-y divide-border">
            {query.data.entries.map((entry) => {
              const changes = changedFields(entry);
              return (
                <details key={entry.id} className="group px-4 py-3.5 sm:px-5">
                  <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${operationStyle(entry.operation)}`}
                      >
                        {entry.operation}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-navy">
                          {TABLE_LABELS[entry.table_name] ?? entry.table_name} ·{" "}
                          {recordTitle(entry)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {entry.actor_email ?? entry.actor_id ?? "System / unknown actor"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                      <Clock3 size={14} />
                      <time dateTime={entry.changed_at}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(entry.changed_at))}
                      </time>
                    </div>
                  </summary>
                  <div className="mt-3 rounded-lg bg-canvas p-3">
                    {entry.record_id && (
                      <p className="mb-2 font-mono text-[10px] text-muted-foreground">
                        Record ID: {entry.record_id}
                      </p>
                    )}
                    {changes.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[440px] text-left text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              <th className="px-2 py-1.5">Field</th>
                              <th className="px-2 py-1.5">Before</th>
                              <th className="px-2 py-1.5">After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {changes.map((change) => (
                              <tr key={change.field} className="border-t border-border">
                                <th className="px-2 py-2 font-semibold text-navy">
                                  {change.field.replaceAll("_", " ")}
                                </th>
                                <td className="max-w-64 break-all px-2 py-2 text-muted-foreground">
                                  {displayValue(change.before)}
                                </td>
                                <td className="max-w-64 break-all px-2 py-2 font-medium text-foreground">
                                  {displayValue(change.after)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No field-level changes.</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
            <Filter size={24} />
            <p className="text-sm font-semibold text-navy">No changes found</p>
            <p className="text-xs">
              {entryCount === 0
                ? "Changes made after audit logging is enabled will appear here."
                : "Try changing the selected filters."}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{entryCount.toLocaleString()} logged change(s)</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnOutline}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0 || query.isFetching}
            aria-label="Previous audit page"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          <span>
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            className={btnOutline}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={page + 1 >= pageCount || query.isFetching}
            aria-label="Next audit page"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
