import React, { useEffect, useMemo, useRef, useState, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { useTimesheetsForMonth, type TimesheetRecord } from "@/lib/payroll-data";
import { useProjects } from "@/lib/management-data";
import { dbAny } from "@/integrations/supabase/external-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { btnOutline, btnPrimary, input, select } from "./ui";
import { TimeControl } from "./TimeControl";

type AttendanceStatus = TimesheetRecord["status"];
type AttendanceEntry = Omit<TimesheetRecord, "id" | "created_at" | "total_hours" | "regular_hours">;

interface DayDraft {
  status: AttendanceStatus | "";
  site: string;
  projectId: string;
  foreman: string;
  foremanUserId: string;
  inTime: string;
  outTime: string;
  breakHours: string;
  overtime: string;
  remarks: string;
}

interface Props {
  employees: Employee[];
  saving: boolean;
  onSave: (rows: AttendanceEntry[]) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  notify: (message: string, tone?: "ok" | "warn") => void;
}

const ATTENDANCE_STATUSES: Array<{ value: AttendanceStatus; label: string }> = [
  { value: "PRESENT", label: "Present" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "ABSENT", label: "Absent" },
  { value: "LEAVE", label: "Leave" },
  { value: "HOLIDAY", label: "Holiday" },
  { value: "WEEKLY_OFF", label: "Weekly off" },
];

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year!, monthNumber!, 0).getDate();
}

function dayFromRecord(entry: TimesheetRecord): DayDraft {
  return {
    status: entry.status,
    site: entry.site,
    projectId: entry.project_id ?? "",
    foreman: entry.foreman,
    foremanUserId: entry.foreman_user_id ?? "",
    inTime: entry.in_time?.slice(0, 5) ?? "",
    outTime: entry.out_time?.slice(0, 5) ?? "",
    breakHours: String(entry.break_hours ?? 0),
    overtime: String(entry.overtime_hours ?? 0),
    remarks: entry.remarks ?? "",
  };
}

function emptyDay(): DayDraft {
  return {
    status: "",
    site: "",
    projectId: "",
    foreman: "",
    foremanUserId: "",
    inTime: "",
    outTime: "",
    breakHours: "0",
    overtime: "0",
    remarks: "",
  };
}

function worked(status: AttendanceStatus) {
  return status === "PRESENT" || status === "HALF_DAY";
}

interface MonthDayRowProps {
  day: number;
  row: DayDraft;
  projects: Array<{ id: string; name: string; active: boolean }>;
  foremanOptions: Array<{ value: string; userId: string | null; name: string; label: string }>;
  updateDay: (day: number, patch: Partial<DayDraft>) => void;
}

// Memoized individual row component to prevent re-rendering all 31 days on single-day edits
const MonthDayRow = memo(function MonthDayRow({
  day,
  row,
  projects,
  foremanOptions,
  updateDay,
}: MonthDayRowProps) {
  const isWorked = row.status ? worked(row.status) : false;

  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1.5 font-semibold text-navy">{day}</td>
      <td className="px-2 py-1.5">
        <select
          value={row.status}
          onChange={(event) =>
            updateDay(day, {
              status: event.target.value as AttendanceStatus | "",
            })
          }
          aria-label={`Day ${day} status`}
          className={`${select} min-w-32 px-2 py-1`}
        >
          <option value="">Not recorded</option>
          {ATTENDANCE_STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={
            row.projectId ||
            projects.find((project) => project.name === row.site)?.id ||
            ""
          }
          onChange={(event) => {
            const project = projects.find((item) => item.id === event.target.value);
            updateDay(day, {
              projectId: project?.id ?? "",
              site: project?.name ?? "",
            });
          }}
          aria-label={`Day ${day} site`}
          className={`${select} min-w-40 px-2 py-1`}
        >
          <option value="">Choose project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
              {project.active ? "" : " (completed)"}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={
            row.foremanUserId ||
            foremanOptions.find((option) => option.name === row.foreman)?.value ||
            ""
          }
          onChange={(event) => {
            const option = foremanOptions.find((item) => item.value === event.target.value);
            updateDay(day, {
              foreman: option?.name ?? "",
              foremanUserId: option?.userId ?? "",
            });
          }}
          aria-label={`Day ${day} foreman`}
          className={`${select} min-w-40 px-2 py-1`}
        >
          <option value="">Choose foreman</option>
          {foremanOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <TimeControl
          value={row.inTime}
          disabled={!isWorked}
          onChange={(value) => updateDay(day, { inTime: value })}
          label={`Day ${day} in time`}
        />
      </td>
      <td className="px-2 py-1.5">
        <TimeControl
          value={row.outTime}
          disabled={!isWorked}
          onChange={(value) => updateDay(day, { outTime: value })}
          label={`Day ${day} out time`}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min="0"
          step="0.25"
          value={row.breakHours}
          disabled={!isWorked}
          onChange={(event) => updateDay(day, { breakHours: event.target.value })}
          aria-label={`Day ${day} break hours`}
          className={`${input} w-20 px-2 py-1 text-right disabled:opacity-50`}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          min="0"
          step="0.25"
          value={row.overtime}
          disabled={!isWorked}
          onChange={(event) => updateDay(day, { overtime: event.target.value })}
          aria-label={`Day ${day} overtime hours`}
          className={`${input} w-20 px-2 py-1 text-right disabled:opacity-50`}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={row.remarks}
          onChange={(event) => updateDay(day, { remarks: event.target.value })}
          aria-label={`Day ${day} remarks`}
          className={`${input} attendance-notes-input w-12 px-1 py-1`}
        />
      </td>
    </tr>
  );
});

export function MonthlyAttendanceDialog({
  employees,
  saving,
  onSave,
  onOpenChange,
  notify,
}: Props) {
  const [month, setMonth] = useState(currentMonth);
  const [employeeId, setEmployeeId] = useState("");
  const [days, setDays] = useState<Record<number, DayDraft>>({});
  const loadedContext = useRef("");
  const timesheetsQuery = useTimesheetsForMonth(month);
  const projectsQuery = useProjects(true);
  const foremenQuery = useQuery({
    queryKey: ["management", "timesheet-foremen"],
    queryFn: async (): Promise<
      Array<{ user_id: string; full_name: string | null; email: string | null }>
    > => {
      const { data, error } = await dbAny
        .from("users")
        .select("user_id,full_name,email")
        .eq("role", "foreman")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        user_id: string;
        full_name: string | null;
        email: string | null;
      }>;
    },
  });
  const calendarDays = useMemo(
    () => Array.from({ length: daysInMonth(month) }, (_, index) => index + 1),
    [month],
  );
  const employeesByName = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );
  const projects = projectsQuery.data ?? [];
  const foremanOptions = useMemo(() => {
    const options: Array<{ value: string; userId: string | null; name: string; label: string }> = (
      foremenQuery.data ?? []
    ).map((user) => ({
      value: user.user_id,
      userId: user.user_id,
      name: user.full_name?.trim() || user.email || "Unnamed foreman",
      label: user.email
        ? `${user.full_name?.trim() || user.email} · ${user.email}`
        : user.full_name || "Unnamed foreman",
    }));
    const knownNames = new Set(options.map((option) => option.name.toLowerCase()));
    for (const name of [
      ...(timesheetsQuery.data ?? []).map((entry) => entry.foreman),
      ...employees
        .filter((employee) => employee.trade === "FORMAN")
        .map((employee) => employee.name),
    ]) {
      const normalized = name.trim().toLowerCase();
      if (!normalized || knownNames.has(normalized)) continue;
      knownNames.add(normalized);
      options.push({ value: `legacy:${name}`, userId: null, name, label: name });
    }
    return options;
  }, [employees, foremenQuery.data, timesheetsQuery.data]);

  useEffect(() => {
    if (!employeeId || timesheetsQuery.isLoading || timesheetsQuery.error) return;
    const context = `${month}:${employeeId}`;
    if (loadedContext.current === context) return;

    const entries = (timesheetsQuery.data ?? []).filter(
      (entry) => String(entry.employee_id) === employeeId,
    );
    setDays(
      Object.fromEntries(
        entries.map((entry) => [Number(entry.work_date.slice(-2)), dayFromRecord(entry)]),
      ),
    );
    loadedContext.current = context;
  }, [employeeId, month, timesheetsQuery.data, timesheetsQuery.error, timesheetsQuery.isLoading]);

  const updateDay = useMemo(() => {
    return (day: number, patch: Partial<DayDraft>) => {
      setDays((current) => {
        const next = { ...(current[day] ?? emptyDay()), ...patch };
        if (patch.status && !worked(patch.status)) {
          next.inTime = "";
          next.outTime = "";
          next.breakHours = "0";
          next.overtime = "0";
        } else if (patch.status && worked(patch.status)) {
          next.inTime ||= "08:00";
          next.outTime ||= "17:00";
          next.breakHours ||= "1";
        }
        return { ...current, [day]: next };
      });
    };
  }, []);

  const save = async () => {
    if (!employeeId) {
      notify("Select an employee before saving monthly attendance.", "warn");
      return;
    }

    const entries = calendarDays.flatMap((day) => {
      const row = days[day];
      return row?.status ? [{ day, row }] : [];
    });
    if (!entries.length) {
      notify("Choose an attendance status for at least one day.", "warn");
      return;
    }

    const invalidDays = entries.filter(({ row }) => {
      const projectId = row.projectId || projects.find((project) => project.name === row.site)?.id;
      const foremanOption = foremanOptions.find(
        (option) => option.userId === row.foremanUserId || option.name === row.foreman,
      );
      if (!row.site.trim() || !projectId || !row.foreman.trim() || !foremanOption) return true;
      if (!worked(row.status as AttendanceStatus)) return false;
      const [startHour, startMinute] = row.inTime.split(":").map(Number);
      const [endHour, endMinute] = row.outTime.split(":").map(Number);
      const start = startHour! * 60 + startMinute!;
      const end = endHour! * 60 + endMinute!;
      const breakHours = Number(row.breakHours);
      const overtime = Number(row.overtime);
      const shiftHours = (end - start) / 60;
      return (
        !row.inTime ||
        !row.outTime ||
        end <= start ||
        !Number.isFinite(breakHours) ||
        breakHours < 0 ||
        breakHours > shiftHours ||
        !Number.isFinite(overtime) ||
        overtime < 0 ||
        overtime > shiftHours - breakHours
      );
    });
    if (invalidDays.length) {
      notify(
        `Check site, foreman, time, break, and overtime values for day(s) ${invalidDays.map(({ day }) => day).join(", ")}.`,
        "warn",
      );
      return;
    }

    const rows = entries.map(({ day, row }) => {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const doesWork = worked(row.status as AttendanceStatus);
      return {
        employee_id: Number(employeeId),
        site: row.site.trim(),
        project_id:
          row.projectId || projects.find((project) => project.name === row.site)?.id || null,
        foreman: row.foreman.trim(),
        foreman_user_id:
          row.foremanUserId ||
          foremanOptions.find((option) => option.name === row.foreman)?.userId ||
          null,
        work_date: date,
        status: row.status as AttendanceStatus,
        in_time: doesWork ? row.inTime : null,
        out_time: doesWork ? row.outTime : null,
        break_hours: doesWork ? Number(row.breakHours) || 0 : 0,
        overtime_hours: doesWork ? Number(row.overtime) || 0 : 0,
        remarks: row.remarks.trim() || null,
      } satisfies AttendanceEntry;
    });

    try {
      await onSave(rows);
      notify(`${rows.length} attendance day(s) saved for ${month}.`);
      onOpenChange(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save monthly attendance.", "warn");
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="font-display text-xl font-extrabold text-navy">
            Monthly attendance entry
          </DialogTitle>
          <DialogDescription>
            Enter one employee’s attendance by day. Days without a status are left unrecorded.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 border-b border-border bg-navy-soft px-4 py-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Employee
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              className={`${select} mt-1`}
            >
              <option value="">Select employee</option>
              {employeesByName.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} · {employee.id_number || employee.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Month
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className={`${input} mt-1`}
            />
          </label>
        </div>

        {timesheetsQuery.error && (
          <p className="m-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            Could not load monthly attendance: {timesheetsQuery.error.message}
          </p>
        )}
        {projectsQuery.error && (
          <p role="alert" className="mx-4 mt-3 text-sm text-danger">
            Could not load projects: {projectsQuery.error.message}
          </p>
        )}
        {foremenQuery.error && (
          <p role="alert" className="mx-4 mt-3 text-sm text-danger">
            Could not load foremen: {foremenQuery.error.message}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {timesheetsQuery.isLoading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Loading attendance for {month}…
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1250px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-navy-soft text-[10px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-2 py-2">Day</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Site / project</th>
                    <th className="px-2 py-2">Foreman</th>
                    <th className="px-2 py-2">In</th>
                    <th className="px-2 py-2">Out</th>
                    <th className="px-2 py-2">Break</th>
                    <th className="px-2 py-2">Overtime</th>
                    <th className="w-24 px-2 py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {calendarDays.map((day) => {
                    const row = days[day] ?? emptyDay();
                    return (
                      <MonthDayRow
                        key={day}
                        day={day}
                        row={row}
                        projects={projects}
                        foremanOptions={foremanOptions}
                        updateDay={updateDay}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className={btnOutline}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              saving ||
              timesheetsQuery.isLoading ||
              projectsQuery.isLoading ||
              foremenQuery.isLoading ||
              Boolean(timesheetsQuery.error || projectsQuery.error || foremenQuery.error)
            }
            className={btnPrimary}
          >
            <Save size={15} /> {saving ? "Saving…" : "Save monthly attendance"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
