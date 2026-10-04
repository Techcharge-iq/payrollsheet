import { useMemo, useState } from "react";
import { ChevronRight, Eye, Pencil, Plus, Search, Users } from "lucide-react";
import { TRADES, fmt, type Employee, type PayrollBatch } from "@/lib/payroll";
import { btnGold, btnIcon, btnOutline, card, input, select } from "./ui";

interface Props {
  employees: Employee[];
  batches: PayrollBatch[];
  loading: boolean;
  onNew: () => void;
  onView: (e: Employee) => void;
  onEdit: (e: Employee) => void;
}

const statusStyle: Record<string, string> = {
  Active: "bg-money/10 text-money border-money/30",
  Holiday: "bg-gold/15 text-gold-dark border-gold/40",
  Cancelled: "bg-danger/10 text-danger border-danger/30",
};

export function EmployeesTab({ employees, loading, onNew, onView, onEdit }: Props) {
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState("");

  const filtered = useMemo(
    () =>
      employees
        .slice()
        .sort((a, b) => a.id - b.id)
        .filter((e) => tradeFilter === "ALL" || e.trade === tradeFilter)
        .filter((e) => statusFilter === "ALL" || e.status === statusFilter)
        .filter((e) => {
          const q = search.trim().toLowerCase();
          return (
            !q ||
            e.name.toLowerCase().includes(q) ||
            String(e.id_number ?? "")
              .toLowerCase()
              .includes(q)
          );
        }),
    [employees, search, tradeFilter, statusFilter],
  );

  const selected = employees.find((e) => String(e.id) === selectedId) || null;
  const activeCount = employees.filter((e) => e.status === "Active").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:hidden">
        <div className="mobile-metric mobile-metric-primary">
          <p>Active staff</p>
          <strong>{activeCount}</strong>
        </div>
        <div className="mobile-metric">
          <p>Total employees</p>
          <strong>{employees.length}</strong>
        </div>
      </div>
      <div className={card + " hidden flex-col gap-3 p-4 sm:flex sm:flex-row sm:items-center"}>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className={select + " sm:w-64"}
          >
            <option value="">Select employee…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.trade}
              </option>
            ))}
          </select>
          <button
            disabled={!selected}
            onClick={() => selected && onView(selected)}
            className={btnOutline}
          >
            <Eye size={15} /> View
          </button>
          <button
            disabled={!selected}
            onClick={() => selected && onEdit(selected)}
            className={btnOutline}
          >
            <Pencil size={15} /> Edit
          </button>
        </div>
        <button onClick={onNew} className={btnGold}>
          <Plus size={16} /> New employee
        </button>
      </div>

      <div className="mobile-filter-bar flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID…"
            className={input + " pl-9"}
          />
        </div>
        <select
          value={tradeFilter}
          onChange={(e) => setTradeFilter(e.target.value)}
          aria-label="Filter by trade"
          className={select + " sm:w-44"}
        >
          <option value="ALL">All trades</option>
          {TRADES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={select + " sm:w-40"}
        >
          <option value="ALL">All statuses</option>
          <option>Active</option>
          <option>Holiday</option>
          <option>Cancelled</option>
        </select>
      </div>

      <div className="space-y-3 sm:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <div key={i} className="mobile-list-skeleton" />)
        ) : filtered.length === 0 ? (
          <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
            No employees match this search.
          </div>
        ) : (
          filtered.map((employee) => (
            <article
              key={employee.id}
              className="mobile-list-card"
              onClick={() => onView(employee)}
            >
              <div className="mobile-avatar" aria-hidden="true">
                {employee.name
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-bold text-foreground">{employee.name}</h2>
                  <span className={`status-pill ${statusStyle[employee.status]}`}>
                    {employee.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {employee.trade} · ID {employee.id_number || "Not assigned"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Salary / hr{" "}
                  <strong className="text-foreground">{fmt(employee.hourly_rate)} OMR</strong>
                </p>
              </div>
              <button
                aria-label={`Edit ${employee.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(employee);
                }}
                className={btnIcon}
              >
                <Pencil size={16} />
              </button>
              <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
            </article>
          ))
        )}
      </div>

      <div className={card + " hidden overflow-hidden sm:block"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-navy-soft text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">S.No</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Trade</th>
                <th className="px-4 py-3">ID number</th>
                <th className="px-4 py-3 text-right">Salary / hr</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No employees match this search.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-0 hover:bg-navy-soft/50"
                  >
                    <td className="px-4 py-2.5 text-slate-500">{e.id}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{e.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{e.trade}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {e.id_number || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-navy">
                      {fmt(e.hourly_rate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusStyle[e.status]}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => onView(e)} title="View details" className={btnIcon}>
                          <Eye size={16} />
                        </button>
                        <button onClick={() => onEdit(e)} title="Edit" className={btnIcon}>
                          <Pencil size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Users size={13} /> Showing {filtered.length} of {employees.length} employees — saved in the
        cloud database.
      </p>
    </div>
  );
}
