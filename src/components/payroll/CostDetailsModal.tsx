import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Search, Share2, Users, X } from "lucide-react";
import { fmt, monthLabel, type Employee } from "@/lib/payroll";
import { allocationTotals, buildAllocationRows, type AllocationRow } from "@/lib/cost-allocation";
import { usePayrollSiteAllocations } from "@/lib/payroll-data";
import {
  COMPANY_NAME,
  costReportBlob,
  costReportFilename,
  downloadCostReport,
} from "@/lib/cost-pdf";
import { downloadCostExcel } from "@/lib/cost-excel";
import { btnGold, btnOutline, card, input, select } from "./ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  month?: string;
  notify?: ((msg: string, tone?: "ok" | "warn") => void) | undefined;
}

export function CostDetailsModal({ open, onClose, employees, month = "", notify }: Props) {
  const [query, setQuery] = useState("");
  const [fMonth, setFMonth] = useState(month);
  const [fSite, setFSite] = useState("");
  const [fForeman, setFForeman] = useState("");
  const [detail, setDetail] = useState<AllocationRow | null>(null);
  const allocationsQuery = usePayrollSiteAllocations(fMonth, open);

  useEffect(() => {
    if (open) setFMonth(month);
  }, [open, month]);

  const all = useMemo(
    () => buildAllocationRows(allocationsQuery.data ?? [], employees),
    [allocationsQuery.data, employees],
  );

  const sites = useMemo(() => [...new Set(all.map((r) => r.site))].sort(), [all]);
  const foremen = useMemo(() => [...new Set(all.map((r) => r.foreman))].sort(), [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!fMonth || r.month === fMonth) &&
        (!fSite || r.site === fSite) &&
        (!fForeman || r.foreman === fForeman) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.employeeId.toLowerCase().includes(q) ||
          r.site.toLowerCase().includes(q) ||
          r.foreman.toLowerCase().includes(q)),
    );
  }, [all, query, fMonth, fSite, fForeman]);

  const totals = useMemo(() => allocationTotals(rows), [rows]);
  const meta = { month: fMonth, site: fSite, foreman: fForeman };

  const share = async () => {
    if (!rows.length) return;
    const file = new File([costReportBlob(rows, meta)], costReportFilename(meta), {
      type: "application/pdf",
    });
    const nav = navigator as Navigator & {
      canShare?: (d: { files?: File[] }) => boolean;
      share?: (d: unknown) => Promise<void>;
    };
    const title = `${COMPANY_NAME} — Cost Allocation${fMonth ? ` ${monthLabel(fMonth)}` : ""}`;
    try {
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title, text: title });
        return;
      }
      if (nav.share) {
        await nav.share({ title, text: title });
        return;
      }
    } catch {
      /* user cancelled */
    }
    downloadCostReport(rows, meta);
    notify?.("Sharing isn't supported here — the PDF was downloaded so you can send it.", "warn");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="flex max-h-[94vh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4 pr-12">
          <DialogHeader className="mr-auto min-w-48 text-left">
            <DialogTitle className="font-display text-xl font-extrabold text-navy">
              Cost allocation
            </DialogTitle>
            <DialogDescription>
              {rows.length.toLocaleString()} employee record(s)
              {fMonth ? ` · ${monthLabel(fMonth)}` : " · All months"}
            </DialogDescription>
          </DialogHeader>
          <button
            onClick={() => downloadCostReport(rows, meta)}
            disabled={!rows.length}
            className={btnGold}
          >
            <Download size={15} /> Download PDF
          </button>
          <button
            onClick={() => downloadCostExcel(rows, meta)}
            disabled={!rows.length}
            className={btnOutline}
          >
            <FileSpreadsheet size={15} /> Download Excel
          </button>
          <button onClick={() => void share()} disabled={!rows.length} className={btnOutline}>
            <Share2 size={15} /> Share
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 border-b border-border bg-canvas/60 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employee, ID, site…"
              className={input + " pl-8"}
            />
          </div>
          <input
            type="month"
            value={fMonth}
            onChange={(e) => setFMonth(e.target.value)}
            className={select}
            aria-label="Payroll month"
          />
          <select value={fSite} onChange={(e) => setFSite(e.target.value)} className={select}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={fForeman} onChange={(e) => setFForeman(e.target.value)} className={select}>
            <option value="">All foremen</option>
            {foremen.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3 sm:grid-cols-4">
          {[
            { label: "Employees", value: String(totals.staff), icon: true },
            { label: "Regular pay", value: `${fmt(totals.regularPay)} OMR` },
            { label: "Overtime pay", value: `${fmt(totals.overtimePay)} OMR` },
            {
              label: "Allocated gross cost",
              value: `${fmt(totals.grossCost)} OMR`,
            },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl bg-navy-soft/70 px-3 py-2.5">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {metric.icon && <Users size={12} />}
                {metric.label}
              </p>
              <p className="mt-1 truncate font-display text-sm font-extrabold text-navy">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1200px] text-xs">
            <thead className="sticky top-0 z-10 bg-navy-soft">
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">Emp ID</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Trade</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Foreman</th>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Regular hrs</th>
                <th className="px-3 py-2 text-right">OT hrs</th>
                <th className="px-3 py-2 text-right">Regular pay</th>
                <th className="px-3 py-2 text-right">OT pay</th>
                <th className="px-3 py-2 text-right">Allowances</th>
                <th className="px-3 py-2 text-right">Gross cost</th>
                <th className="px-3 py-2">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-slate-400">
                    {allocationsQuery.isLoading
                      ? "Loading site allocations…"
                      : allocationsQuery.error
                        ? `Could not load site allocations: ${allocationsQuery.error.message}`
                        : "No verified attendance-based allocations for this month."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-navy-soft/60"
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {r.employeeId}
                    </td>
                    <td className="px-3 py-2 font-semibold text-navy">{r.name}</td>
                    <td className="px-3 py-2 text-slate-600">{r.trade}</td>
                    <td className="px-3 py-2 text-slate-600">{r.site}</td>
                    <td className="px-3 py-2 text-slate-600">{r.foreman}</td>
                    <td className="px-3 py-2 text-slate-600">{r.month}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.regularHours)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.overtimeHours)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.allocatedRegularPay)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.allocatedOvertimePay)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.allocatedAllowances)}</td>
                    <td className="px-3 py-2 text-right font-bold text-money">
                      {fmt(r.grossCost)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.allocationBasis}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="space-y-2 p-3 md:hidden">
            {rows.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">No matching records.</p>
            )}
            {rows.map((r) => (
              <button
                key={r.key}
                onClick={() => setDetail(r)}
                className={card + " w-full p-3 text-left"}
              >
                <p className="text-sm font-bold text-navy">{r.name}</p>
                <p className="text-[11px] text-slate-500">
                  ID {r.employeeId} · {r.site} · {r.foreman} · {r.month}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <span>
                    Regular hrs <b>{fmt(r.regularHours)}</b>
                  </span>
                  <span>
                    OT hrs <b>{fmt(r.overtimeHours)}</b>
                  </span>
                  <span>
                    Gross <b className="text-money">{fmt(r.grossCost)}</b>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 border-t border-border bg-navy-soft/60 px-4 py-3 text-xs font-bold text-navy">
          <span>Total staff: {totals.staff}</span>
          <span>Regular hours: {fmt(totals.regularHours)}</span>
          <span>Overtime hours: {fmt(totals.overtimeHours)}</span>
          <span>Regular pay: {fmt(totals.regularPay)} OMR</span>
          <span>Overtime pay: {fmt(totals.overtimePay)} OMR</span>
          <span className="text-money">Allocated gross cost: {fmt(totals.grossCost)} OMR</span>
        </div>

        {detail && (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setDetail(null)}
          >
            <div className={card + " w-full max-w-md p-5"} onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-extrabold text-navy">{detail.name}</h3>
                  <p className="text-xs text-slate-500">
                    {detail.trade} · ID {detail.employeeId}
                  </p>
                </div>
                <button onClick={() => setDetail(null)} className={btnOutline}>
                  <X size={15} />
                </button>
              </div>
              <dl className="space-y-1 text-sm">
                {(
                  [
                    ["Site / project", detail.site],
                    ["Foreman", detail.foreman],
                    ["Month", monthLabel(detail.month)],
                    ["Regular hours", fmt(detail.regularHours)],
                    ["Overtime hours", fmt(detail.overtimeHours)],
                    ["Allocated regular pay", fmt(detail.allocatedRegularPay)],
                    ["Allocated overtime pay", fmt(detail.allocatedOvertimePay)],
                    ["Allocated allowances", fmt(detail.allocatedAllowances)],
                    ["Allocated gross cost", fmt(detail.grossCost)],
                    ["Allocation basis", detail.allocationBasis],
                  ] as const
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between border-b border-border py-1 last:border-0"
                  >
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-semibold text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
