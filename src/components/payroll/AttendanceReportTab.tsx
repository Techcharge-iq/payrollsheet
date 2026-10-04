import { useMemo, useState } from "react";
import { CalendarDays, Clock3, MapPin, Users } from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { useTimesheetsForMonth } from "@/lib/payroll-data";
import { currentPayrollMonth, fmt, monthLabel, payrollMonthOptions } from "@/lib/payroll";
import { card, select } from "./ui";

interface Props {
  employees: Employee[];
}

export function AttendanceReportTab({ employees }: Props) {
  const [filter, setFilter] = useState<"staff" | "site">("staff");
  const [month, setMonth] = useState(currentPayrollMonth);
  const [employeeId, setEmployeeId] = useState("");
  const [site, setSite] = useState("");
  const timesheetsQuery = useTimesheetsForMonth(month);
  const timesheets = useMemo(() => timesheetsQuery.data ?? [], [timesheetsQuery.data]);
  const loading = timesheetsQuery.isLoading;
  const error = timesheetsQuery.error instanceof Error ? timesheetsQuery.error.message : "";

  const sites = useMemo(
    () => [...new Set(timesheets.map((entry) => entry.site).filter(Boolean))].sort(),
    [timesheets],
  );
  const monthOptions = useMemo(
    () =>
      [
        ...new Set([
          ...payrollMonthOptions(),
          ...timesheets.map((entry) => entry.work_date.slice(0, 7)),
        ]),
      ].sort(),
    [timesheets],
  );
  const reportRows = useMemo(
    () => timesheets.filter((entry) => entry.work_date.startsWith(`${month}-`)),
    [timesheets, month],
  );
  const selectedEmployee = employees.find((employee) => String(employee.id) === employeeId);
  const employeeRows = reportRows
    .filter((entry) => String(entry.employee_id) === employeeId)
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
  const daysInMonth = month
    ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    : 0;
  const dailyRows = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const date = `${month}-${day}`;
    return { date, entry: employeeRows.find((row) => row.work_date === date) };
  });

  const siteRows = useMemo(() => {
    const grouped = new Map<
      number,
      { employee: Employee | undefined; days: number; hours: number; foremen: Set<string> }
    >();
    reportRows
      .filter(
        (entry) =>
          entry.site === site && (entry.status === "PRESENT" || entry.status === "HALF_DAY"),
      )
      .forEach((entry) => {
        const current = grouped.get(entry.employee_id) ?? {
          employee: employees.find((employee) => employee.id === entry.employee_id),
          days: 0,
          hours: 0,
          foremen: new Set<string>(),
        };
        current.days += 1;
        current.hours += Number(entry.regular_hours) + Number(entry.overtime_hours);
        current.foremen.add(entry.foreman);
        grouped.set(entry.employee_id, current);
      });
    return [...grouped.entries()]
      .map(([id, summary]) => ({ id, ...summary }))
      .sort((a, b) => (a.employee?.name ?? "").localeCompare(b.employee?.name ?? ""));
  }, [employees, reportRows, site]);

  const siteTotals = siteRows.reduce(
    (totals, worker) => ({
      days: totals.days + worker.days,
      hours: totals.hours + worker.hours,
    }),
    { days: 0, hours: 0 },
  );
  const staffTotals = employeeRows
    .filter((entry) => entry.status === "PRESENT" || entry.status === "HALF_DAY")
    .reduce(
      (totals, entry) => ({
        days: totals.days + 1,
        hours: totals.hours + Number(entry.regular_hours) + Number(entry.overtime_hours),
      }),
      { days: 0, hours: 0 },
    );

  return (
    <section className="space-y-4">
      <header className={card + " flex items-center gap-3 p-4"}>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-soft text-navy">
          <CalendarDays size={20} />
        </div>
        <div>
          <h2 className="font-display text-lg font-extrabold text-navy">Attendance report</h2>
          <p className="text-xs text-muted-foreground">
            Review monthly hours by employee or work site.
          </p>
        </div>
      </header>

      <div className={card + " space-y-4 p-4"}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Report filter">
          <button
            type="button"
            onClick={() => setFilter("staff")}
            aria-pressed={filter === "staff"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              filter === "staff" ? "bg-navy text-white" : "border border-border text-slate-600"
            }`}
          >
            Filter by staff
          </button>
          <button
            type="button"
            onClick={() => setFilter("site")}
            aria-pressed={filter === "site"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              filter === "site" ? "bg-navy text-white" : "border border-border text-slate-600"
            }`}
          >
            Filter by site
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {filter === "staff" ? (
            <label className="text-xs font-semibold text-slate-600">
              Employee
              <select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                className={select + " mt-1"}
              >
                <option value="">Select employee…</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name} — {employee.trade}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-xs font-semibold text-slate-600">
              Site
              <select
                value={site}
                onChange={(event) => setSite(event.target.value)}
                className={select + " mt-1"}
              >
                <option value="">Select site…</option>
                {sites.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-semibold text-slate-600">
            Month
            <select
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className={select + " mt-1"}
            >
              {monthOptions.map((option) => (
                <option key={option} value={option}>
                  {monthLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
          Loading attendance report…
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : filter === "staff" ? (
        !selectedEmployee ? (
          <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
            Select an employee to view their monthly attendance.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Employee", value: selectedEmployee.name, icon: Users },
                { label: "Days present", value: staffTotals.days, icon: CalendarDays },
                { label: "Hours logged", value: fmt(staffTotals.hours), icon: Clock3 },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className={card + " flex min-w-0 items-center gap-3 p-3"}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-soft text-navy">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="truncate text-sm font-extrabold text-navy">{value}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className={card + " overflow-hidden"}>
              <div className="border-b border-border px-4 py-3">
                <h3 className="font-bold text-navy">
                  {selectedEmployee.name} · {monthLabel(month)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Daily attendance with hours, site and foreman.
                </p>
              </div>
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="sticky top-0 bg-navy-soft text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Hours</th>
                      <th className="px-4 py-3">Site</th>
                      <th className="px-4 py-3">Foreman</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.map(({ date, entry }) => (
                      <tr key={date} className="border-t border-border">
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          {new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                          })}
                        </td>
                        <td className="px-4 py-2.5 font-medium">
                          {entry?.status.replaceAll("_", " ") ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 font-bold text-navy">
                          {entry
                            ? fmt(Number(entry.regular_hours) + Number(entry.overtime_hours))
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {entry?.site ?? <span className="text-slate-300">No attendance</span>}
                        </td>
                        <td className="px-4 py-2.5">{entry?.foreman ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : !site ? (
        <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
          Select a site to view its monthly workforce summary.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Workers", value: siteRows.length, icon: Users },
              { label: "Days present", value: siteTotals.days, icon: CalendarDays },
              { label: "Hours contributed", value: fmt(siteTotals.hours), icon: Clock3 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className={card + " min-w-0 p-3"}>
                <div className="flex items-center gap-2 text-navy">
                  <Icon size={16} />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </span>
                </div>
                <p className="mt-2 truncate font-display text-lg font-extrabold text-navy">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className={card + " overflow-hidden"}>
            <div className="border-b border-border px-4 py-3">
              <h3 className="flex items-center gap-2 font-bold text-navy">
                <MapPin size={16} />
                {site}
              </h3>
              <p className="text-xs text-muted-foreground">
                {monthLabel(month)} · worker attendance totals
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-navy-soft text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Worker</th>
                    <th className="px-4 py-3">Trade</th>
                    <th className="px-4 py-3 text-right">Days present</th>
                    <th className="px-4 py-3 text-right">Total hours</th>
                    <th className="px-4 py-3">Foreman(s)</th>
                  </tr>
                </thead>
                <tbody>
                  {siteRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No workers recorded at this site for {monthLabel(month)}.
                      </td>
                    </tr>
                  ) : (
                    siteRows.map((worker) => (
                      <tr key={worker.id} className="border-t border-border">
                        <td className="px-4 py-3 font-semibold text-navy">
                          {worker.employee?.name ?? "Former employee"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {worker.employee?.trade ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{worker.days}</td>
                        <td className="px-4 py-3 text-right font-bold text-navy">
                          {fmt(worker.hours)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {[...worker.foremen].join(", ")}
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
    </section>
  );
}
