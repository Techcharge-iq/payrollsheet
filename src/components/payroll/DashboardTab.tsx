import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Banknote,
  CalendarCheck,
  CalendarClock,
  Clock3,
  FilePlus2,
  Plus,
  UserRoundPlus,
  Users,
  Wallet,
} from "lucide-react";
import {
  advanceOutstanding,
  currentPayrollMonth,
  fmt,
  monthLabel,
  toNum,
  type AdvanceTx,
  type Employee,
  type PayrollBatch,
} from "@/lib/payroll";
import { useTimesheetsForDate } from "@/lib/payroll-data";
import { btnGold, btnOutline, card } from "./ui";

interface Props {
  employees: Employee[];
  batches: PayrollBatch[];
  advances: AdvanceTx[];
  email: string;
  onRecordAttendance: () => void;
  onCreatePayroll: () => void;
  onNewEmployee: () => void;
  onAddAdvance: () => void;
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function DashboardTab({
  employees,
  batches,
  advances,
  email,
  onRecordAttendance,
  onCreatePayroll,
  onNewEmployee,
  onAddAdvance,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const date = localDate(now);
  const month = currentPayrollMonth();
  const attendanceQuery = useTimesheetsForDate(date);
  const attendance = attendanceQuery.data ?? [];
  const activeEmployees = employees.filter((employee) => employee.status === "Active");
  const presentCount = attendance.filter(
    (entry) => entry.status === "PRESENT" || entry.status === "HALF_DAY",
  ).length;
  const recordedCount = attendance.length;
  const workedHours = attendance.reduce((sum, entry) => sum + toNum(entry.total_hours), 0);
  const monthBatches = useMemo(
    () => batches.filter((batch) => batch.month === month),
    [batches, month],
  );
  const pendingBatches = monthBatches.filter((batch) => ["DRAFT", "REVIEW"].includes(batch.status));
  const pendingPayroll = pendingBatches.reduce(
    (sum, batch) =>
      sum +
      batch.lines.reduce((lineSum, line) => lineSum + toNum(line.net_salary) - toNum(line.paid), 0),
    0,
  );
  const currentMonthBalance = monthBatches.reduce(
    (sum, batch) =>
      sum +
      batch.lines.reduce((lineSum, line) => lineSum + toNum(line.net_salary) - toNum(line.paid), 0),
    0,
  );
  const advanceBalance = employees.reduce(
    (sum, employee) => sum + advanceOutstanding(employee.id, batches, advances),
    0,
  );
  const attendanceProgress = activeEmployees.length
    ? Math.min(100, (recordedCount / activeEmployees.length) * 100)
    : 0;
  const greetingName = email.split("@")[0]?.split(/[._-]/)[0] || "there";
  const dateLabel = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-5">
      <section className="dashboard-hero overflow-hidden rounded-2xl p-5 text-white sm:p-7 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/65">
              Site payroll · Operations
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold sm:text-3xl">
              {greeting(now.getHours())}, {greetingName}
            </h1>
            <p className="mt-2 text-sm text-white/75">{dateLabel}</p>
          </div>
          <div className="dashboard-clock rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">
              Local time
            </p>
            <p className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold tabular-nums">
              <Clock3 size={19} className="text-teal-200" />
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={onRecordAttendance} className={btnGold}>
            <CalendarCheck size={16} /> Record today’s attendance
          </button>
          <button
            type="button"
            onClick={onCreatePayroll}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/20"
          >
            <FilePlus2 size={16} /> Create payroll
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Operations summary">
        {[
          {
            label: "Active employees",
            value: String(activeEmployees.length),
            helper: `${employees.length} total employees`,
            icon: Users,
            tone: "navy",
          },
          {
            label: "Present today",
            value: attendanceQuery.isLoading ? "…" : String(presentCount),
            helper: `${recordedCount} of ${activeEmployees.length} recorded`,
            icon: CalendarCheck,
            tone: "green",
          },
          {
            label: "Payroll balance",
            value: `${fmt(currentMonthBalance)} OMR`,
            helper: monthLabel(month),
            icon: Wallet,
            tone: "teal",
          },
          {
            label: "Advance balance",
            value: `${fmt(advanceBalance)} OMR`,
            helper: "Outstanding across employees",
            icon: Banknote,
            tone: advanceBalance > 0 ? "gold" : "navy",
          },
        ].map(({ label, value, helper, icon: Icon, tone }) => (
          <article key={label} className={`dashboard-stat ${card}`} data-tone={tone}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:text-xs">
                  {label}
                </p>
                <p className="mt-2 truncate font-display text-xl font-extrabold text-navy sm:text-2xl">
                  {value}
                </p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground sm:text-xs">
                  {helper}
                </p>
              </div>
              <span className="dashboard-stat-icon">
                <Icon size={18} />
              </span>
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className={`${card} p-4 sm:p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-display text-base font-extrabold text-navy">
                <CalendarClock size={18} className="text-gold-dark" /> Attendance today
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {attendanceQuery.error
                  ? "Attendance summary could not be loaded."
                  : `${recordedCount} of ${activeEmployees.length} active employees have a record for ${date}.`}
              </p>
            </div>
            <button type="button" onClick={onRecordAttendance} className={btnOutline}>
              Open timesheets <ArrowRight size={15} />
            </button>
          </div>
          {attendanceQuery.error ? (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger">
              {attendanceQuery.error.message}
            </p>
          ) : (
            <>
              <div
                className="mt-5 h-2.5 overflow-hidden rounded-full bg-navy-soft"
                role="progressbar"
                aria-label="Attendance recording progress"
                aria-valuemin={0}
                aria-valuemax={activeEmployees.length}
                aria-valuenow={recordedCount}
              >
                <div
                  className="h-full rounded-full bg-money transition-[width] duration-500"
                  style={{ width: `${attendanceProgress}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "Present", value: presentCount },
                  { label: "Other status", value: Math.max(0, recordedCount - presentCount) },
                  { label: "Hours logged", value: fmt(workedHours) },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-lg bg-navy-soft/65 px-2 py-3">
                    <p className="font-display text-lg font-extrabold tabular-nums text-navy">
                      {metric.value}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                      {metric.label}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className={`${card} p-4 sm:p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-base font-extrabold text-navy">Payroll to action</p>
              <p className="mt-1 text-xs text-muted-foreground">{monthLabel(month)}</p>
            </div>
            <button
              type="button"
              onClick={onCreatePayroll}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-white transition-colors hover:bg-navy-dark"
              aria-label="Open payroll"
              title="Open payroll"
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
              <span className="text-xs font-semibold text-slate-600">Draft / review batches</span>
              <strong className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-extrabold text-warn">
                {pendingBatches.length}
              </strong>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
              <span className="text-xs font-semibold text-slate-600">Pending in those batches</span>
              <strong className="text-sm font-extrabold tabular-nums text-navy">
                {fmt(pendingPayroll)} OMR
              </strong>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
              <span className="text-xs font-semibold text-slate-600">Attendance hours today</span>
              <strong className="text-sm font-extrabold tabular-nums text-navy">
                {fmt(workedHours)} hrs
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-extrabold text-navy">Immediate actions</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Jump straight into today’s most common tasks.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Record attendance",
              detail: "Start a site batch",
              icon: CalendarCheck,
              action: onRecordAttendance,
            },
            {
              label: "Create payroll",
              detail: "Prepare this month’s wages",
              icon: FilePlus2,
              action: onCreatePayroll,
            },
            {
              label: "Add employee",
              detail: "Create a staff profile",
              icon: UserRoundPlus,
              action: onNewEmployee,
            },
            {
              label: "Log an advance",
              detail: "Record money issued",
              icon: Plus,
              action: onAddAdvance,
            },
          ].map(({ label, detail, icon: Icon, action }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              className="dashboard-action group flex min-h-24 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-md sm:min-h-28 sm:p-4"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-soft text-navy transition-colors group-hover:bg-navy group-hover:text-white">
                <Icon size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-extrabold text-navy sm:text-sm">{label}</span>
                <span className="mt-1 block text-[10px] leading-4 text-muted-foreground sm:text-xs">
                  {detail}
                </span>
              </span>
              <ArrowRight
                size={15}
                className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-navy"
              />
            </button>
          ))}
        </div>
      </section>

      <p className="text-right text-[10px] text-muted-foreground">
        Attendance date: {date} · Payroll month: {month}
      </p>
    </div>
  );
}
