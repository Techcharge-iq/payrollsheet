import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileDown,
  CheckSquare,
  Square,
  Search,
} from "lucide-react";
import {
  currentPayrollMonth,
  advanceCarryForward,
  advanceOutstanding,
  employeeRows,
  fmt,
  lineBalance,
  monthLabel,
  payrollMonthOptions,
  toNum,
  type AdvanceTx,
  type Employee,
  type PayrollBatch,
} from "@/lib/payroll";
import { downloadSlips, type SlipInput } from "@/lib/slip-pdf";
import { btnGold, btnOutline, card, input, select } from "./ui";

interface Props {
  employees: Employee[];
  batches: PayrollBatch[];
  advances: AdvanceTx[];
  notify: (msg: string, tone?: "ok" | "warn") => void;
}

type SortKey = "employee" | "trade" | "foreman";
type SortDirection = "asc" | "desc";

export function SlipsTab({ employees, batches, advances, notify }: Props) {
  const [month, setMonth] = useState(currentPayrollMonth);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("employee");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    const out: Array<{ employee: Employee; row: ReturnType<typeof employeeRows>[number] }> = [];
    batches
      .filter((b) => b.month === month)
      .forEach((b) => {
        b.lines.forEach((l) => {
          const employee = empById.get(Number(l.employee_id));
          if (!employee) return;
          out.push({
            employee,
            row: {
              ...l,
              month: b.month,
              site: b.site,
              batchForeman: b.foreman,
              batchId: b.id,
            },
          });
        });
      });
    return out.sort((a, b) => {
      const aValue =
        sortKey === "employee"
          ? a.employee.name
          : sortKey === "trade"
            ? a.employee.trade
            : a.row.foreman || a.row.batchForeman || "";
      const bValue =
        sortKey === "employee"
          ? b.employee.name
          : sortKey === "trade"
            ? b.employee.trade
            : b.row.foreman || b.row.batchForeman || "";
      const comparison = aValue.localeCompare(bValue);
      return (
        (sortDirection === "asc" ? comparison : -comparison) ||
        a.employee.name.localeCompare(b.employee.name)
      );
    });
  }, [batches, month, empById, sortKey, sortDirection]);
  const visibleRows = useMemo(
    () => rows.filter((row) => row.employee.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  const sortBy = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={13} />;
    return sortDirection === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />;
  };

  const allSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.employee.id));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((previous) => {
      const next = new Set(previous);
      visibleRows.forEach(({ employee }) => {
        if (allSelected) next.delete(employee.id);
        else next.add(employee.id);
      });
      return next;
    });

  const download = async () => {
    if (isDownloading) return;
    const picked = rows.filter((r) => selected.has(r.employee.id));
    if (!picked.length) {
      notify("Select at least one employee to generate slips.", "warn");
      return;
    }
    const slips: SlipInput[] = picked.map(({ employee, row }) => ({
      employee,
      month,
      row,
      carriedForward: advanceCarryForward(employee.id, month, batches, advances),
      outstandingAdvance: advanceOutstanding(employee.id, batches, advances),
    }));
    try {
      setIsDownloading(true);
      setDownloadProgress(slips.length > 1 ? 0 : null);
      await downloadSlips(slips, {
        onProgress: (completed) => setDownloadProgress(completed),
      });
      notify(`${slips.length} salary slip(s) downloaded.`);
    } catch (error) {
      console.error("Unable to generate salary slips.", error);
      notify(
        error instanceof Error
          ? error.message
          : "Unable to generate salary slips. Please try again.",
        "warn",
      );
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card + " flex flex-col gap-3 p-4 lg:flex-row lg:items-end"}>
        <div className="lg:w-64">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payroll month
          </label>
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setSelected(new Set());
            }}
            className={select}
          >
            {payrollMonthOptions().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee…"
            className={input + " pl-9"}
          />
        </div>
        <button onClick={toggleAll} disabled={!visibleRows.length} className={btnOutline}>
          {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
          {allSelected ? "Clear all" : "Select all"}
        </button>
        <button onClick={download} disabled={isDownloading} className={btnGold}>
          <FileDown size={16} /> Download {selected.size || ""} slip{selected.size === 1 ? "" : "s"}
          {downloadProgress !== null &&
            ` — Generating salary slips... ${downloadProgress} of ${selected.size}`}
        </button>
      </div>

      <div className={card + " overflow-hidden"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-navy-soft text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => sortBy("employee")}
                    className="inline-flex items-center gap-1 hover:text-navy"
                  >
                    Employee {sortIcon("employee")}
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => sortBy("trade")}
                    className="inline-flex items-center gap-1 hover:text-navy"
                  >
                    Trade {sortIcon("trade")}
                  </button>
                </th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => sortBy("foreman")}
                    className="inline-flex items-center gap-1 hover:text-navy"
                  >
                    Foreman {sortIcon("foreman")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Net (OMR)</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    {rows.length
                      ? "No employees match this search."
                      : `No payroll lines for ${monthLabel(month)}.`}
                  </td>
                </tr>
              ) : (
                visibleRows.map(({ employee, row }) => {
                  const checked = selected.has(employee.id);
                  return (
                    <tr
                      key={`${row.batchId}-${employee.id}`}
                      onClick={() => toggle(employee.id)}
                      className={`cursor-pointer border-b border-border last:border-0 ${
                        checked ? "bg-gold/10" : "hover:bg-navy-soft/50"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className={checked ? "text-gold-dark" : "text-slate-400"}>
                          {checked ? <CheckSquare size={17} /> : <Square size={17} />}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{employee.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{employee.trade}</td>
                      <td className="px-4 py-2.5 text-slate-600">{row.site || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {row.foreman || row.batchForeman || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(toNum(row.hours))}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-money">
                        {fmt(toNum(row.net_salary))}
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(toNum(row.paid))}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {fmt(lineBalance(row))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
