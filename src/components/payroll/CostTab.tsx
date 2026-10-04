import { useMemo, useState } from "react";
import { ChevronRight, List, MapPin, Users } from "lucide-react";
import { currentPayrollMonth, fmt, type Employee } from "@/lib/payroll";
import { btnGold, card, select } from "./ui";
import { CostDetailsModal } from "./CostDetailsModal";
import { usePayrollSiteAllocations } from "@/lib/payroll-data";
import { allocationTotals, buildAllocationRows } from "@/lib/cost-allocation";

type GroupBy = "site" | "foreman" | "site+foreman";

interface Props {
  employees: Employee[];
  notify?: (msg: string, tone?: "ok" | "warn") => void;
}

export function CostTab({ employees, notify }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("site");
  const [filterMonth, setFilterMonth] = useState(currentPayrollMonth);
  const [listOpen, setListOpen] = useState(false);
  const allocationsQuery = usePayrollSiteAllocations(filterMonth);
  const allocationRows = useMemo(
    () => buildAllocationRows(allocationsQuery.data ?? [], employees),
    [allocationsQuery.data, employees],
  );
  const totals = useMemo(() => allocationTotals(allocationRows), [allocationRows]);

  const costRows = useMemo(() => {
    const buckets: Record<
      string,
      {
        label: string;
        workers: Set<string>;
        gross: number;
        regularHours: number;
        overtimeHours: number;
      }
    > = {};
    allocationRows.forEach((allocation) => {
      const key =
        groupBy === "site"
          ? allocation.site
          : groupBy === "foreman"
            ? allocation.foreman
            : `${allocation.site} / ${allocation.foreman}`;
      buckets[key] ??= {
        label: key,
        workers: new Set(),
        gross: 0,
        regularHours: 0,
        overtimeHours: 0,
      };
      const bucket = buckets[key];
      bucket.workers.add(allocation.employeeId);
      bucket.gross += allocation.grossCost;
      bucket.regularHours += allocation.regularHours;
      bucket.overtimeHours += allocation.overtimeHours;
    });
    return Object.values(buckets)
      .map((b) => ({ ...b, workers: b.workers.size }))
      .sort((a, b) => b.gross - a.gross);
  }, [allocationRows, groupBy]);

  const grand = useMemo(() => {
    return {
      workers: totals.staff,
      gross: totals.grossCost,
      regularHours: totals.regularHours,
      overtimeHours: totals.overtimeHours,
    };
  }, [totals]);

  return (
    <div className="space-y-4">
      <div className={card + " mobile-toolbar flex flex-wrap items-center gap-3 p-4"}>
        <input
          type="month"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className={select + " sm:w-56"}
          aria-label="Payroll month"
        />
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          {(
            [
              ["site", "By Site"],
              ["foreman", "By Foreman"],
              ["site+foreman", "Site + Foreman"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setGroupBy(value)}
              className={`px-3 py-2 font-semibold transition-colors ${
                groupBy === value
                  ? "bg-navy text-primary-foreground"
                  : "bg-card text-slate-600 hover:bg-navy-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setListOpen(true)} className={btnGold + " ml-auto"}>
          <List size={15} /> View List
        </button>
        <p className="w-full text-xs text-muted-foreground lg:w-auto">
          Gross labour cost is allocated by actual attendance hours. Advances and employee
          deductions are excluded; historical payroll without verified attendance allocation is not
          estimated.
        </p>
      </div>

      <CostDetailsModal
        open={listOpen}
        onClose={() => setListOpen(false)}
        employees={employees}
        month={filterMonth}
        notify={notify}
      />

      <div className="mobile-metric-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Unique workers", value: String(grand.workers) },
          { label: "Allocated gross labour cost (OMR)", value: fmt(grand.gross), money: true },
          { label: "Regular hours", value: fmt(grand.regularHours) },
          { label: "Overtime hours", value: fmt(grand.overtimeHours) },
        ].map((s) => (
          <div
            key={s.label}
            className={`${card} p-3.5 ${s.label.includes("remaining") ? "mobile-metric-alert" : ""}`}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {s.label}
            </p>
            <p className={`text-xl font-extrabold ${s.money ? "text-money" : "text-navy"}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3 sm:hidden">
        {costRows.length === 0 ? (
          <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
            No payroll data for the selected period.
          </div>
        ) : (
          costRows.map((row) => (
            <button
              key={row.label}
              onClick={() => setListOpen(true)}
              className="mobile-list-card w-full text-left"
            >
              <div className="mobile-avatar">
                <MapPin size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold text-foreground">{row.label}</h2>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Users size={13} /> {row.workers} workers
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <span className="data-badge">
                    <small>Regular hrs</small>
                    {fmt(row.regularHours)}
                  </span>
                  <span className="data-badge data-badge-due">
                    <small>OT hrs</small>
                    {fmt(row.overtimeHours)}
                  </span>
                  <span className="data-badge data-badge-paid">
                    <small>Gross cost</small>
                    {fmt(row.gross)}
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
      </div>
      <div className={card + " hidden overflow-hidden sm:block"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-navy-soft text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3 text-right">Workers</th>
                <th className="px-4 py-3 text-right">Regular hours</th>
                <th className="px-4 py-3 text-right">Overtime hours</th>
                <th className="px-4 py-3 text-right">Gross labour cost (OMR)</th>
              </tr>
            </thead>
            <tbody>
              {costRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    {allocationsQuery.isLoading
                      ? "Loading verified site allocations…"
                      : allocationsQuery.error
                        ? `Could not load site allocations: ${allocationsQuery.error.message}`
                        : "No verified attendance-based allocations for the selected month."}
                  </td>
                </tr>
              ) : (
                costRows.map((r) => {
                  return (
                    <tr
                      key={r.label}
                      className="border-b border-border last:border-0 hover:bg-navy-soft/50"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{r.label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{r.workers}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {fmt(r.regularHours)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {fmt(r.overtimeHours)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-money">
                        {fmt(r.gross)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {costRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-navy-soft/70 font-bold text-navy">
                  <td className="px-4 py-2.5">TOTAL</td>
                  <td className="px-4 py-2.5 text-right">{grand.workers}</td>
                  <td className="px-4 py-2.5 text-right">{fmt(grand.regularHours)}</td>
                  <td className="px-4 py-2.5 text-right">{fmt(grand.overtimeHours)}</td>
                  <td className="px-4 py-2.5 text-right text-money">{fmt(grand.gross)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
