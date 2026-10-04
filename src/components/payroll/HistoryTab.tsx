import { useMemo, useState } from "react";
import { History, FileDown } from "lucide-react";
import {
  employeeRows,
  fmt,
  lineBalance,
  lineGross,
  monthLabel,
  advanceOutstanding,
  advanceCarryForward,
  type AdvanceTx,
  rowTotals,
  toNum,
  type Employee,
  type PayrollBatch,
} from "@/lib/payroll";
import { downloadSlips } from "@/lib/slip-pdf";
import { btnGold, btnOutline, card, select } from "./ui";

interface Props {
  employees: Employee[];
  batches: PayrollBatch[];
  advances: AdvanceTx[];
}

export function HistoryTab({ employees, batches, advances }: Props) {
  const [employeeId, setEmployeeId] = useState("");

  const employee = employees.find((e) => String(e.id) === employeeId) || null;
  const rows = useMemo(
    () => (employee ? employeeRows(batches, employee.id) : []),
    [batches, employee],
  );
  const totals = rowTotals(rows);
  const outstanding = employee ? advanceOutstanding(employee.id, batches, advances) : 0;
  const empAdvances = employee
    ? advances
        .filter((a) => String(a.employee_id) === String(employee.id))
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  const exportAll = () => {
    if (!employee) return;
    downloadSlips(
      rows.map((row) => ({
        employee,
        month: row.month,
        row,
        carriedForward: advanceCarryForward(employee.id, row.month, batches, advances),
        outstandingAdvance: outstanding,
      })),
    );
  };

  return (
    <div className="space-y-4">
      <div className={card + " flex flex-col gap-3 p-4 sm:flex-row sm:items-center"}>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Employee
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={select + " sm:w-80"}
          >
            <option value="">Select an employee…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.trade}
              </option>
            ))}
          </select>
        </div>
        <button onClick={exportAll} disabled={!rows.length} className={btnGold}>
          <FileDown size={16} /> Download all slips
        </button>
      </div>

      {!employee && (
        <div className={card + " flex flex-col items-center gap-2 p-12 text-slate-400"}>
          <History size={26} />
          <p className="text-sm">Select an employee to see their month-by-month payroll history.</p>
        </div>
      )}

      {employee && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: "Months recorded", value: String(rows.length) },
              { label: "Total hours", value: fmt(totals.hours) },
              { label: "Total gross", value: fmt(totals.gross) },
              { label: "Total paid", value: fmt(totals.paid) },
              { label: "Balance due", value: fmt(totals.balance) },
            ].map((s) => (
              <div key={s.label} className={card + " p-3.5"}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {s.label}
                </p>
                <p className="text-xl font-extrabold text-navy">{s.value}</p>
              </div>
            ))}
          </div>

          <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-medium text-slate-700">
            Advance outstanding for {employee.name}:{" "}
            <strong className="text-warn">{fmt(outstanding)} OMR</strong> — carried forward
            automatically into the next payroll month.
          </p>

          <div className={card + " overflow-hidden"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-navy-soft text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    <th className="px-3 py-3">Month</th>
                    <th className="px-3 py-3">Site / Foreman</th>
                    <th className="px-3 py-3 text-right">Hours</th>
                    <th className="px-3 py-3 text-right">Salary / hr</th>
                    <th className="px-3 py-3 text-right">Gross</th>
                    <th className="px-3 py-3 text-right">Food</th>
                    <th className="px-3 py-3 text-right">Prev adv.</th>
                    <th className="px-3 py-3 text-right">New adv.</th>
                    <th className="px-3 py-3 text-right">Other ded.</th>
                    <th className="px-3 py-3 text-right">Net</th>
                    <th className="px-3 py-3 text-right">Paid</th>
                    <th className="px-3 py-3 text-right">Balance</th>
                    <th className="px-3 py-3 text-center">Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-8 text-center text-slate-400">
                        No payroll records for this employee yet.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={`${r.batchId}-${r.month}`}
                        className="border-b border-border last:border-0 hover:bg-navy-soft/50"
                      >
                        <td className="px-3 py-2.5 font-semibold text-navy">
                          {monthLabel(r.month)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {r.site || "—"} / {r.foreman || r.batchForeman || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(r.hours))}</td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(r.rate))}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {fmt(lineGross(r))}
                        </td>
                        <td className="px-3 py-2.5 text-right text-danger">
                          {fmt(toNum(r.food_deduction))}
                        </td>
                        <td className="px-3 py-2.5 text-right text-warn">
                          {fmt(toNum(r.prev_advance))}
                        </td>
                        <td className="px-3 py-2.5 text-right text-warn">
                          {fmt(toNum(r.new_advance))}
                        </td>
                        <td className="px-3 py-2.5 text-right text-danger">
                          {fmt(toNum(r.other_deduction))}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-money">
                          {fmt(toNum(r.net_salary))}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(r.paid))}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {fmt(lineBalance(r))}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() =>
                              downloadSlips([
                                {
                                  employee,
                                  month: r.month,
                                  row: r,
                                  carriedForward: advanceCarryForward(
                                    employee.id,
                                    r.month,
                                    batches,
                                    advances,
                                  ),
                                  outstandingAdvance: outstanding,
                                },
                              ])
                            }
                            className={btnOutline + " px-2 py-1 text-[11px]"}
                          >
                            <FileDown size={13} /> PDF
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-navy-soft/70 font-bold text-navy">
                      <td className="px-3 py-2.5" colSpan={2}>
                        TOTAL
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.hours)}</td>
                      <td />
                      <td className="px-3 py-2.5 text-right">{fmt(totals.gross)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.food)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.prevAdv)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.newAdv)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.otherDeduct)}</td>
                      <td className="px-3 py-2.5 text-right text-money">{fmt(totals.net)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.paid)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(totals.balance)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          <div className={card + " overflow-hidden"}>
            <p className="border-b border-border bg-navy-soft/60 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-navy">
              Advance transactions
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Notes</th>
                    <th className="px-3 py-2 text-right">Balance after month</th>
                  </tr>
                </thead>
                <tbody>
                  {empAdvances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                        No advances issued to this employee yet.
                      </td>
                    </tr>
                  ) : (
                    empAdvances.map((a) => (
                      <tr key={a.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 font-semibold text-navy">{a.date}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-warn">
                          {fmt(toNum(a.amount))}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{a.reason || "\u2014"}</td>
                        <td className="px-3 py-2.5 text-slate-600">{a.payment_method}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.notes || "\u2014"}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {fmt(
                            advanceCarryForward(
                              employee.id,
                              nextMonthOf(a.date),
                              batches,
                              advances,
                            ),
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** First day-month after the month of `date`, used for carry-forward display. */
function nextMonthOf(date: string) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
