import { useMemo, useState } from "react";
import { CalendarDays, Clock3, MapPin, Users } from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { useTimesheetsForMonth, type TimesheetRecord } from "@/lib/payroll-data";
import { currentPayrollMonth, fmt, monthLabel, payrollMonthOptions } from "@/lib/payroll";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { card, select } from "./ui";

interface Props {
  employees: Employee[];
}

interface AttendanceMatrixRow {
  id: number;
  name: string;
  trade: string;
  hours: number;
}

function AttendanceMatrix({
  title,
  description,
  days,
  rows,
  entryByEmployeeDay,
  site,
}: {
  title: string;
  description: string;
  days: string[];
  rows: AttendanceMatrixRow[];
  entryByEmployeeDay: Map<string, TimesheetRecord>;
  site?: string | undefined;
}) {
  return (
    <div className={card + " overflow-hidden"}>
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-bold text-navy">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No workers recorded for this report.
        </p>
      ) : (
        <TooltipProvider delayDuration={250}>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-20 bg-navy-soft text-[10px] font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="sticky left-0 z-30 min-w-52 border-b border-r border-border bg-navy-soft px-3 py-2 text-left">
                    Name of staff
                  </th>
                  <th className="sticky left-52 z-30 min-w-14 border-b border-r border-border bg-navy-soft px-2 py-2 text-left">
                    Trade
                  </th>
                  {days.map((date) => (
                    <th
                      key={date}
                      className="min-w-11 border-b border-r border-border px-1 py-2 text-center"
                    >
                      {Number(date.slice(-2))}
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 min-w-20 border-b border-l border-border bg-navy-soft px-2 py-2 text-right">
                    Total hrs
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th className="sticky left-0 z-10 min-w-52 border-b border-r border-border bg-background px-3 py-1.5 text-left font-medium text-slate-800">
                      {row.name}
                    </th>
                    <td className="sticky left-52 z-10 min-w-14 border-b border-r border-border bg-background px-2 py-1.5 text-slate-600">
                      {row.trade}
                    </td>
                    {days.map((date) => (
                      <td
                        key={date}
                        className="border-b border-r border-border px-0.5 py-1 text-center"
                      >
                        <AttendanceCell
                          date={date}
                          entry={entryByEmployeeDay.get(`${row.id}:${date}`)}
                          site={site}
                        />
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 border-b border-l border-border bg-background px-2 py-1.5 text-right font-bold text-navy">
                      {fmt(row.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

function isWorked(entry: TimesheetRecord) {
  return entry.status === "PRESENT" || entry.status === "HALF_DAY";
}

function isFriday(date: string) {
  return new Date(`${date}T00:00:00`).getDay() === 5;
}

function compactHours(hours: number) {
  return String(Number(hours.toFixed(3)));
}

function netHours(entry: TimesheetRecord) {
  return Number(entry.total_hours ?? Number(entry.regular_hours) + Number(entry.overtime_hours));
}

function AttendanceCell({
  date,
  entry,
  site,
}: {
  date: string;
  entry: TimesheetRecord | undefined;
  site?: string | undefined;
}) {
  const worked = entry ? isWorked(entry) : false;
  const isDifferentSite = Boolean(worked && site && entry && entry.site !== site);
  const label =
    entry?.status === "ABSENT"
      ? "A"
      : worked
        ? isDifferentSite
          ? "T"
          : compactHours(netHours(entry))
        : entry?.status === "LEAVE"
          ? "L"
          : entry?.status === "HOLIDAY"
            ? "H"
            : isFriday(date)
              ? "F"
              : "";
  const cellStyle =
    label === "A"
      ? "bg-[#d98270] text-white"
      : label === "F"
        ? "bg-blue-500 text-white"
        : label === "T"
          ? "bg-amber-100 font-bold text-amber-900"
          : label === "L" || label === "H"
            ? "bg-slate-100 text-slate-600"
            : "text-slate-800";
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${dateLabel}: ${label || "no attendance recorded"}`}
          className={`inline-flex min-h-8 min-w-10 items-center justify-center rounded-sm px-1 text-xs ${cellStyle}`}
        >
          {label || "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-56 space-y-1 text-left">
        <p className="font-semibold">{dateLabel}</p>
        {worked && entry ? (
          <>
            <p>{isDifferentSite ? `Worked at: ${entry.site}` : `Site: ${entry.site}`}</p>
            <p>
              Check-in: {entry.in_time?.slice(0, 5) ?? "—"} · Check-out:{" "}
              {entry.out_time?.slice(0, 5) ?? "—"}
            </p>
            <p>Break: {fmt(Number(entry.break_hours))} hrs</p>
            {!isDifferentSite && <p>Net hours: {compactHours(netHours(entry))}</p>}
          </>
        ) : (
          <p>
            {entry?.status === "ABSENT"
              ? "Absent"
              : entry?.status === "LEAVE"
                ? "Leave"
                : entry?.status === "HOLIDAY"
                  ? "Holiday"
                  : label === "F"
                    ? "Friday"
                    : "No attendance recorded"}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
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
  const reportDays = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
  const entryByEmployeeDay = useMemo(
    () => new Map(reportRows.map((entry) => [`${entry.employee_id}:${entry.work_date}`, entry])),
    [reportRows],
  );

  const siteRows = useMemo(() => {
    const grouped = new Map<
      number,
      { employee: Employee | undefined; days: number; hours: number }
    >();
    reportRows
      .filter((entry) => entry.site === site)
      .forEach((entry) => {
        const current = grouped.get(entry.employee_id) ?? {
          employee: employees.find((employee) => employee.id === entry.employee_id),
          days: 0,
          hours: 0,
        };
        if (isWorked(entry)) {
          current.days += 1;
          current.hours += netHours(entry);
        }
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
        hours: totals.hours + netHours(entry),
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
            <AttendanceMatrix
              title={`${selectedEmployee.name} · ${monthLabel(month)}`}
              description="Daily net hours. Hover or focus a cell to see shift times and break."
              days={reportDays}
              rows={[
                {
                  id: selectedEmployee.id,
                  name: selectedEmployee.name,
                  trade: selectedEmployee.trade,
                  hours: staffTotals.hours,
                },
              ]}
              entryByEmployeeDay={entryByEmployeeDay}
            />
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
          <AttendanceMatrix
            title={`${monthLabel(month)} · ${site}`}
            description="T means the employee worked at another site. Hover or focus a cell for site and shift details."
            days={reportDays}
            rows={siteRows.map((worker) => ({
              id: worker.id,
              name: worker.employee?.name ?? "Former employee",
              trade: worker.employee?.trade ?? "—",
              hours: worker.hours,
            }))}
            entryByEmployeeDay={entryByEmployeeDay}
            site={site}
          />
        </>
      )}
    </section>
  );
}
