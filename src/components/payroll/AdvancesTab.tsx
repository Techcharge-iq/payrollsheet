import { useMemo, useState } from "react";
import { Banknote, Eye, Plus, Save, Trash2, X, Search } from "lucide-react";
import {
  ADVANCE_REASONS,
  PAYMENT_METHODS,
  advanceOutstanding,
  advancesIssued,
  advancesRecovered,
  fmt,
  monthLabel,
  toNum,
  txMonth,
  type AdvanceTx,
  type Employee,
  type PayrollBatch,
} from "@/lib/payroll";
import { btnGold, btnIcon, btnOutline, card, input, select } from "./ui";

interface Props {
  employees: Employee[];
  batches: PayrollBatch[];
  advances: AdvanceTx[];
  saving: boolean;
  notify: (msg: string, tone?: "ok" | "warn") => void;
  onSave: (tx: Partial<AdvanceTx> & { id?: string }, done: () => void) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}

interface Form {
  id?: string;
  employee_id: string;
  date: string;
  amount: string;
  reason: string;
  payment_method: string;
  notes: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): Form => ({
  employee_id: "",
  date: todayISO(),
  amount: "",
  reason: ADVANCE_REASONS[0]!,
  payment_method: "Cash",
  notes: "",
});

export function AdvancesTab({
  employees,
  batches,
  advances,
  saving,
  notify,
  onSave,
  onDelete,
  canDelete,
}: Props) {
  const [form, setForm] = useState<Form>(emptyForm());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    employees.forEach((e) => m.set(String(e.id), e));
    return m;
  }, [employees]);

  const outstandingEmployeeIds = useMemo(
    () =>
      new Set(
        employees
          .filter((e) => advanceOutstanding(e.id, batches, advances) > 0)
          .map((e) => String(e.id)),
      ),
    [employees, batches, advances],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return advances
      .filter((a) =>
        filterEmployee
          ? String(a.employee_id) === filterEmployee
          : outstandingEmployeeIds.has(String(a.employee_id)),
      )
      .filter((a) => {
        if (!q) return true;
        const name = empById.get(String(a.employee_id))?.name ?? "";
        return (
          name.toLowerCase().includes(q) ||
          a.reason.toLowerCase().includes(q) ||
          a.notes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [advances, filterEmployee, query, empById, outstandingEmployeeIds]);

  const selected = filterEmployee ? (empById.get(filterEmployee) ?? null) : null;
  const outstandingEmployees = useMemo(
    () =>
      employees
        .map((employee) => ({
          employee,
          balance: advanceOutstanding(employee.id, batches, advances),
        }))
        .filter(({ balance }) => balance > 0)
        .sort((a, b) => a.employee.name.localeCompare(b.employee.name)),
    [employees, batches, advances],
  );

  const totals = useMemo(() => {
    const issued = rows.reduce((s, a) => s + toNum(a.amount), 0);
    const recovered = selected ? advancesRecovered(selected.id, batches) : 0;
    const outstanding = selected
      ? advanceOutstanding(selected.id, batches, advances)
      : employees.reduce((s, e) => s + advanceOutstanding(e.id, batches, advances), 0);
    return { issued, recovered, outstanding };
  }, [rows, selected, batches, advances, employees]);

  const monthly = useMemo(() => {
    if (!selected) return [];
    const months = new Set<string>();
    advances
      .filter((a) => String(a.employee_id) === String(selected.id))
      .forEach((a) => months.add(txMonth(a.date)));
    batches.forEach((b) => {
      if (b.lines.some((l) => String(l.employee_id) === String(selected.id))) months.add(b.month);
    });
    return [...months]
      .filter(Boolean)
      .sort()
      .map((m) => {
        const issued = advances
          .filter((a) => String(a.employee_id) === String(selected.id) && txMonth(a.date) === m)
          .reduce((s, a) => s + toNum(a.amount), 0);
        let payrollAdv = 0;
        let recovered = 0;
        batches
          .filter((b) => b.month === m)
          .forEach((b) =>
            b.lines
              .filter((l) => String(l.employee_id) === String(selected.id))
              .forEach((l) => {
                payrollAdv += toNum(l.new_advance);
                recovered += toNum(l.prev_advance);
              }),
          );
        return { month: m, issued: issued + payrollAdv, recovered };
      })
      .reduce<{ month: string; issued: number; recovered: number; balance: number }[]>((acc, r) => {
        const prev = acc.length ? acc[acc.length - 1]!.balance : 0;
        acc.push({ ...r, balance: Math.max(0, prev + r.issued - r.recovered) });
        return acc;
      }, []);
  }, [selected, advances, batches]);

  const submit = () => {
    if (!form.employee_id) return notify("Select an employee.", "warn");
    if (toNum(form.amount) <= 0) return notify("Enter an advance amount.", "warn");
    if (!form.date) return notify("Pick a date.", "warn");
    onSave(
      {
        ...(form.id ? { id: form.id } : {}),
        employee_id: Number(form.employee_id),
        date: form.date,
        amount: toNum(form.amount),
        reason: form.reason,
        payment_method: form.payment_method,
        notes: form.notes,
      },
      () => {
        setForm(emptyForm());
        setOpen(false);
      },
    );
  };

  const viewEmployee = (employeeId: number) => {
    setFilterEmployee(String(employeeId));
    setQuery("");
  };

  return (
    <div className="space-y-4">
      <div
        className={card + " mobile-toolbar flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:p-4"}
      >
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Employee
          </label>
          <select
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            className={select + " w-full sm:w-72"}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.trade}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Search
          </label>
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, reason or note"
              className={input + " pl-8"}
            />
          </div>
        </div>
        <button
          onClick={() => {
            setForm({ ...emptyForm(), employee_id: filterEmployee });
            setOpen(true);
          }}
          className={btnGold + " w-full justify-center sm:w-auto"}
        >
          <Plus size={16} /> New advance
        </button>
      </div>

      <div className="mobile-metric-grid grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Advances listed", value: fmt(totals.issued) },
          {
            label: selected ? "Recovered via payroll" : "Transactions",
            value: selected ? fmt(totals.recovered) : String(rows.length),
          },
          { label: "Outstanding balance", value: fmt(totals.outstanding) },
        ].map((s) => (
          <div
            key={s.label}
            className={`${card} p-3 ${s.label === "Outstanding balance" ? "mobile-metric-alert col-span-2 sm:col-span-1" : ""}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {s.label}
            </p>
            <p className="text-xl font-extrabold text-navy">{s.value}</p>
          </div>
        ))}
      </div>

      {open && (
        <div className={card + " mobile-form-sheet p-4"}>
          <div className="mb-3 flex items-center gap-2">
            <Banknote size={16} className="text-gold-dark" />
            <h2 className="text-sm font-bold text-navy">
              {form.id ? "Edit advance" : "Issue advance"}
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Employee
              </label>
              <select
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                className={select}
              >
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.trade}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Amount (OMR)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Reason
              </label>
              <select
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className={select}
              >
                {ADVANCE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Payment method
              </label>
              <select
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                className={select}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Notes
              </label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional"
                className={input}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={submit} disabled={saving} className={btnGold}>
              <Save size={15} /> {saving ? "Saving…" : "Save advance"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setForm(emptyForm());
              }}
              className={btnOutline}
            >
              <X size={15} /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="sm:rounded-xl sm:border sm:border-border sm:bg-card sm:shadow-sm">
        <div className="space-y-2 p-3 sm:hidden">
          {rows.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-slate-400">
              No advance transactions yet.
            </p>
          ) : (
            rows.map((a) => {
              const emp = empById.get(String(a.employee_id));
              return (
                <div
                  key={a.id}
                  className="mobile-list-card block rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-navy">{emp?.name ?? `#${a.employee_id}`}</p>
                      <p className="text-[11px] text-slate-500">
                        {a.date} · {a.reason || "No reason"}
                      </p>
                    </div>
                    <p className="font-bold text-warn">{fmt(toNum(a.amount))} OMR</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
                    <span className="text-slate-500">
                      Outstanding:{" "}
                      <strong className="text-navy">
                        {fmt(advanceOutstanding(a.employee_id, batches, advances))}
                      </strong>
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        title={`View ${emp?.name ?? "employee"} details`}
                        aria-label={`View ${emp?.name ?? "employee"} advance details`}
                        onClick={() => viewEmployee(a.employee_id)}
                        className={`${btnOutline} h-8 px-2 text-xs`}
                      >
                        <Eye size={13} /> View
                      </button>
                      <button
                        title="Edit"
                        onClick={() => {
                          setForm({
                            id: a.id,
                            employee_id: String(a.employee_id),
                            date: a.date,
                            amount: String(a.amount),
                            reason: a.reason || ADVANCE_REASONS[0]!,
                            payment_method: a.payment_method || "Cash",
                            notes: a.notes,
                          });
                          setOpen(true);
                        }}
                        className={btnIcon}
                      >
                        <Save size={14} />
                      </button>
                      {canDelete && (
                        <button
                          title="Delete"
                          onClick={() => onDelete(a.id)}
                          className={btnIcon + " hover:border-danger hover:text-danger"}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[820px] text-xs">
            <thead>
              <tr className="border-b border-border bg-navy-soft text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Employee</th>
                <th className="px-3 py-3 text-right">Amount</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3">Method</th>
                <th className="px-3 py-3">Notes</th>
                <th className="px-3 py-3 text-right">Outstanding</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                    No advance transactions yet.
                  </td>
                </tr>
              ) : (
                rows.map((a) => {
                  const emp = empById.get(String(a.employee_id));
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-border last:border-0 hover:bg-navy-soft/50"
                    >
                      <td className="px-3 py-2.5 font-semibold text-navy">{a.date}</td>
                      <td className="px-3 py-2.5">{emp?.name ?? `#${a.employee_id}`}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-warn">
                        {fmt(toNum(a.amount))}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{a.reason || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{a.payment_method}</td>
                      <td className="px-3 py-2.5 text-slate-500">{a.notes || "—"}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">
                        {fmt(advanceOutstanding(a.employee_id, batches, advances))}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <button
                            title={`View ${emp?.name ?? "employee"} details`}
                            aria-label={`View ${emp?.name ?? "employee"} advance details`}
                            onClick={() => viewEmployee(a.employee_id)}
                            className={`${btnOutline} h-8 px-2 text-xs`}
                          >
                            <Eye size={13} /> View
                          </button>
                          <button
                            title="Edit"
                            onClick={() => {
                              setForm({
                                id: a.id,
                                employee_id: String(a.employee_id),
                                date: a.date,
                                amount: String(a.amount),
                                reason: a.reason || ADVANCE_REASONS[0]!,
                                payment_method: a.payment_method || "Cash",
                                notes: a.notes,
                              });
                              setOpen(true);
                            }}
                            className={btnIcon}
                          >
                            <Save size={14} />
                          </button>
                          {canDelete && (
                            <button
                              title="Delete"
                              onClick={() => onDelete(a.id)}
                              className={btnIcon + " hover:border-danger hover:text-danger"}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!selected && outstandingEmployees.length > 0 && (
        <div className={card + " overflow-hidden"}>
          <div className="border-b border-border bg-navy-soft/60 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-navy">
            Outstanding balances by employee
          </div>
          <div className="divide-y divide-border sm:hidden">
            {outstandingEmployees.map(({ employee, balance }) => (
              <div key={employee.id} className="flex items-center justify-between gap-3 px-3 py-3">
                <div>
                  <p className="font-semibold text-navy">{employee.name}</p>
                  <p className="text-[11px] text-slate-500">{employee.trade}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-money">{fmt(balance)} OMR</p>
                  <button
                    type="button"
                    onClick={() => viewEmployee(employee.id)}
                    className={`${btnOutline} h-8 px-2 text-xs`}
                  >
                    <Eye size={13} /> View
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Trade</th>
                  <th className="px-4 py-2.5 text-right">Outstanding balance</th>
                  <th className="px-4 py-2.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {outstandingEmployees.map(({ employee, balance }) => (
                  <tr key={employee.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-semibold text-navy">{employee.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{employee.trade}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-money">{fmt(balance)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => viewEmployee(employee.id)}
                        className={`${btnOutline} h-8 px-2.5 text-xs`}
                      >
                        <Eye size={13} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && monthly.length > 0 && (
        <div className={card + " overflow-hidden"}>
          <p className="border-b border-border bg-navy-soft/60 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-navy">
            Monthly advance balance — {selected.name}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Advance given</th>
                <th className="px-3 py-2 text-right">Recovered</th>
                <th className="px-3 py-2 text-right">Balance carried</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-navy">{monthLabel(m.month)}</td>
                  <td className="px-3 py-2.5 text-right text-warn">{fmt(m.issued)}</td>
                  <td className="px-3 py-2.5 text-right text-money">{fmt(m.recovered)}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{fmt(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-medium text-slate-700">
          Total advances issued to {selected.name}:{" "}
          <strong>{fmt(advancesIssued(selected.id, advances))} OMR</strong> — unpaid balance carries
          forward automatically into the next payroll month.
        </p>
      )}
    </div>
  );
}
