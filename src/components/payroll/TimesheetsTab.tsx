import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, Copy, HardHat, Search, Users, X } from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { useTimesheetsForDate, type TimesheetRecord } from "@/lib/payroll-data";
import { btnGold, btnOutline, card, input, inputSm } from "./ui";

interface Props {
  employees: Employee[];
  saving: boolean;
  onSave: (
    rows: Omit<TimesheetRecord, "id" | "created_at" | "total_hours" | "regular_hours">[],
  ) => Promise<void>;
  notify: (message: string, tone?: "ok" | "warn") => void;
  onDirtyChange?: (dirty: boolean) => void;
}

type AttendanceStatus = "PRESENT" | "ABSENT" | "LEAVE" | "HOLIDAY" | "WEEKLY_OFF" | "HALF_DAY";
type AttendanceFilter = "All" | "Review" | AttendanceStatus;

interface AttendanceRow {
  employeeId: number;
  site: string;
  foreman: string;
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
  breakHours: string;
  notes: string;
  overtime: string;
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function parseLocalTime(value: string) {
  if (!value) return null;
  const [hours = Number.NaN, minutes = Number.NaN] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function roundHours(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

function hoursFor(row: Pick<AttendanceRow, "inTime" | "outTime" | "breakHours">) {
  const start = parseLocalTime(row.inTime);
  const end = parseLocalTime(row.outTime);
  if (start === null || end === null || end <= start) return 0;
  const shiftMinutes = end - start;
  const breakMinutes = Number(row.breakHours) * 60 || 0;
  return roundHours((shiftMinutes - breakMinutes) / 60);
}

function regularHoursFor(row: AttendanceRow) {
  return roundHours(Math.max(0, hoursFor(row) - overtimeFor(row)));
}

function overtimeFor(row: Pick<AttendanceRow, "overtime">) {
  const overtime = Number(row.overtime || 0);
  if (!Number.isFinite(overtime) || overtime < 0) return 0;
  return overtime;
}

function isReviewRow(row: AttendanceRow) {
  if (row.status === "PRESENT" || row.status === "HALF_DAY") {
    return !row.inTime || !row.outTime || hoursFor(row) <= 0;
  }
  return false;
}

function exceptionCount(row: AttendanceRow) {
  if (row.status === "ABSENT" || row.status === "LEAVE") return 1;
  if (!row.site.trim() || !row.foreman.trim()) return 1;
  if (isReviewRow(row)) return 1;
  return 0;
}

function toTimesheetRow(employee: Employee, row: AttendanceRow, workDate: string) {
  const worked = row.status === "PRESENT" || row.status === "HALF_DAY";
  return {
    employee_id: employee.id,
    site: row.site.trim() || "Unassigned",
    foreman: row.foreman.trim() || "Unassigned",
    work_date: workDate,
    status: row.status,
    in_time: worked ? row.inTime || null : null,
    out_time: worked ? row.outTime || null : null,
    break_hours: worked ? Number(row.breakHours) || 0 : 0,
    overtime_hours: worked ? Number(row.overtime) || 0 : 0,
    remarks: row.notes.trim() || null,
  } satisfies Omit<TimesheetRecord, "id" | "created_at" | "total_hours" | "regular_hours">;
}

function employeeLabel(employee: Employee) {
  return `${employee.name} — ${employee.trade}`;
}

function initialRow(
  employee: Employee,
  workDate: string,
  site: string,
  foreman: string,
): AttendanceRow {
  const existing = workDate;
  void existing;
  return {
    employeeId: employee.id,
    site,
    foreman,
    status: "PRESENT",
    inTime: "",
    outTime: "",
    breakHours: "0",
    notes: "",
    overtime: "0",
  };
}

function previousCalendarDate(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function TimesheetsTab({ employees, saving, onSave, notify, onDirtyChange }: Props) {
  const [workDate, setWorkDate] = useState(today);
  const previousDate = previousCalendarDate(workDate);
  const timesheetsQuery = useTimesheetsForDate(workDate);
  const previousTimesheetsQuery = useTimesheetsForDate(previousDate);
  const timesheets = useMemo(() => timesheetsQuery.data ?? [], [timesheetsQuery.data]);
  const [siteFilter, setSiteFilter] = useState("Al Khoud");
  const [crewName, setCrewName] = useState("All foremen");
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<AttendanceFilter>("All");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [rows, setRows] = useState<Record<number, AttendanceRow>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(() => new Set());

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((employee) => employee.status === "Active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  const siteOptions = useMemo(
    () =>
      [
        ...new Set([
          ...timesheets.map((entry) => entry.site).filter(Boolean),
          "Al Khoud",
          "Barka",
          "Seeb",
        ]),
      ].sort(),
    [timesheets],
  );

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeEmployees.filter((employee) => {
      const row = rows[employee.id] ?? initialRow(employee, workDate, siteFilter, "");
      if (crewName !== "All foremen" && row.foreman !== crewName) return false;
      if (selectedStatus === "Review" && !isReviewRow(row)) return false;
      if (
        selectedStatus !== "All" &&
        selectedStatus !== "Review" &&
        row.status !== selectedStatus
      ) {
        return false;
      }
      if (!query) return true;
      const haystack = [employee.name, employee.trade, employee.id_number, String(employee.id)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [activeEmployees, crewName, rows, search, selectedStatus, siteFilter, workDate]);

  const selectedEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [activeEmployees, selectedEmployeeId],
  );

  const selectedRow = selectedEmployee ? rows[selectedEmployee.id] : null;

  useEffect(() => {
    const patch: Record<number, AttendanceRow> = {};
    const entriesByEmployee = new Map<number, TimesheetRecord>();
    for (const entry of timesheets) {
      if (entry.work_date === workDate) {
        entriesByEmployee.set(entry.employee_id, entry);
      }
    }

    for (const employee of activeEmployees) {
      const match = entriesByEmployee.get(employee.id);
      const next: AttendanceRow = {
        employeeId: employee.id,
        site: match?.site ?? siteFilter,
        foreman: match?.foreman ?? "",
        status: match?.status ?? "PRESENT",
        inTime: match?.in_time ?? "",
        outTime: match?.out_time ?? "",
        breakHours: String(match?.break_hours ?? 0),
        notes: match?.remarks ?? "",
        overtime: String(match?.overtime_hours ?? 0),
      };
      patch[employee.id] = next;
    }

    setRows(patch);
    setDirtyIds(new Set());
  }, [activeEmployees, siteFilter, workDate, timesheets]);

  useEffect(() => {
    onDirtyChange?.(dirtyIds.size > 0);
  }, [dirtyIds, onDirtyChange]);

  useEffect(() => {
    if (dirtyIds.size === 0) return;
    const protectUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnload);
    return () => window.removeEventListener("beforeunload", protectUnload);
  }, [dirtyIds]);

  const confirmDiscard = () => {
    if (!dirtyIds.size) return true;
    if (!window.confirm("Discard unsaved attendance changes?")) return false;
    setDirtyIds(new Set());
    return true;
  };

  const exceptionSummary = useMemo(() => {
    const total = filteredEmployees.length;
    const missing = filteredEmployees.filter((employee) => {
      const row = rows[employee.id] ?? initialRow(employee, workDate, siteFilter, "");
      return exceptionCount(row) > 0 && row.status !== "LEAVE" && row.status !== "ABSENT";
    }).length;
    const leave = filteredEmployees.filter(
      (employee) =>
        (rows[employee.id] ?? initialRow(employee, workDate, siteFilter, "")).status === "LEAVE",
    ).length;
    const absent = filteredEmployees.filter(
      (employee) =>
        (rows[employee.id] ?? initialRow(employee, workDate, siteFilter, "")).status === "ABSENT",
    ).length;
    const overtime = filteredEmployees.filter((employee) => {
      const row = rows[employee.id] ?? initialRow(employee, workDate, siteFilter, "");
      return overtimeFor(row) > 0;
    }).length;
    return { total, missing, leave, absent, overtime };
  }, [filteredEmployees, rows, siteFilter, workDate]);

  const toggleSelection = (employeeId: number) => {
    setSelectedIds((current) =>
      current.includes(employeeId)
        ? current.filter((value) => value !== employeeId)
        : [...current, employeeId],
    );
    setSelectedEmployeeId(employeeId);
  };

  const updateRow = (employeeId: number, patch: Partial<AttendanceRow>) => {
    setRows((current) => {
      const base =
        current[employeeId] ??
        initialRow(
          activeEmployees.find((employee) => employee.id === employeeId)!,
          workDate,
          siteFilter,
          "",
        );
      const draft = { ...base, ...patch, employeeId };
      if (patch.status) {
        draft.status = patch.status;
        if (
          patch.status === "ABSENT" ||
          patch.status === "LEAVE" ||
          patch.status === "HOLIDAY" ||
          patch.status === "WEEKLY_OFF"
        ) {
          draft.inTime = "";
          draft.outTime = "";
          draft.breakHours = "0";
          draft.overtime = "0";
        }
      }
      setDirtyIds((dirty) => new Set(dirty).add(employeeId));
      return { ...current, [employeeId]: draft };
    });
  };

  const currentRecords = filteredEmployees.map((employee) => ({
    employee,
    row: rows[employee.id] ?? initialRow(employee, workDate, siteFilter, ""),
  }));

  const saveAll = async () => {
    const dirtyRecords = activeEmployees
      .filter((employee) => dirtyIds.has(employee.id))
      .map((employee) => ({
        employee,
        row: rows[employee.id] ?? initialRow(employee, workDate, siteFilter, ""),
      }));
    const invalid = dirtyRecords.filter(
      ({ employee, row }) =>
        (dirtyIds.has(employee.id) &&
          (row.status === "PRESENT" || row.status === "HALF_DAY") &&
          (!row.inTime ||
            !row.outTime ||
            parseLocalTime(row.outTime) === null ||
            parseLocalTime(row.inTime) === null ||
            parseLocalTime(row.outTime)! <= parseLocalTime(row.inTime)! ||
            !Number.isFinite(Number(row.breakHours)) ||
            Number(row.breakHours) < 0 ||
            Number(row.breakHours) > hoursFor(row) ||
            Number(row.overtime) > hoursFor(row))) ||
        (dirtyIds.has(employee.id) &&
          (!Number.isFinite(Number(row.overtime)) || Number(row.overtime) < 0)),
    );
    if (invalid.length) {
      notify(
        `${invalid.length} attendance row(s) have invalid time, break, or overtime values.`,
        "warn",
      );
      return;
    }
    const payload = dirtyRecords.map(({ employee, row }) =>
      toTimesheetRow(
        employee,
        {
          ...row,
          site: row.site || siteFilter || "Unassigned",
          foreman: row.foreman || "Unassigned",
        },
        workDate,
      ),
    );

    if (!payload.length) {
      notify("There are no attendance entries to save for this filtered view.", "warn");
      return;
    }

    try {
      await onSave(payload);
      setDirtyIds(new Set());
      notify(`${payload.length} attendance entr${payload.length === 1 ? "y" : "ies"} saved.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save attendance entries.", "warn");
    }
  };

  const applyBulkAction = (
    action: "present" | "absent" | "leave" | "in" | "out" | "break" | "shift" | "overtime",
    value?: string,
  ) => {
    const targets = selectedIds.length
      ? selectedIds
      : filteredEmployees.map((employee) => employee.id);
    const applicableTargets = targets.filter((employeeId) => {
      if (action !== "overtime") return true;
      const employee = activeEmployees.find((entry) => entry.id === employeeId);
      const row =
        rows[employeeId] ?? (employee ? initialRow(employee, workDate, siteFilter, "") : null);
      return row?.status === "PRESENT" || row?.status === "HALF_DAY";
    });
    if (applicableTargets.length !== targets.length) {
      notify("Overtime was skipped for non-work attendance statuses.", "warn");
    }
    setRows((current) => {
      const next = { ...current };
      for (const employeeId of applicableTargets) {
        const employee = activeEmployees.find((entry) => entry.id === employeeId);
        if (!employee) continue;
        const base = next[employeeId] ?? initialRow(employee, workDate, siteFilter, "");
        const draft = { ...base };
        switch (action) {
          case "present":
            draft.status = "PRESENT";
            break;
          case "absent":
            draft.status = "ABSENT";
            draft.inTime = "";
            draft.outTime = "";
            draft.breakHours = "0";
            draft.overtime = "0";
            break;
          case "leave":
            draft.status = "LEAVE";
            draft.inTime = "";
            draft.outTime = "";
            draft.breakHours = "0";
            draft.overtime = "0";
            break;
          case "in":
            draft.inTime = value ?? "08:00";
            break;
          case "out":
            draft.outTime = value ?? "17:00";
            break;
          case "break":
            draft.breakHours = value ?? "1";
            break;
          case "shift":
            draft.inTime = value ? (value.split("-")[0] ?? "08:00") : "08:00";
            draft.outTime = value ? (value.split("-")[1] ?? "17:00") : "17:00";
            break;
          case "overtime":
            draft.overtime = value ?? "2";
            break;
          default:
            break;
        }
        next[employeeId] = draft;
      }
      setDirtyIds((dirty) => new Set([...dirty, ...applicableTargets]));
      return next;
    });
  };

  const copyPreviousDay = () => {
    if (previousTimesheetsQuery.isLoading) {
      notify("Previous-day attendance is still loading.", "warn");
      return;
    }
    if (previousTimesheetsQuery.error) {
      notify(
        `Could not load previous-day attendance: ${previousTimesheetsQuery.error.message}`,
        "warn",
      );
      return;
    }
    const previousEntries = (previousTimesheetsQuery.data ?? []).filter(
      (entry) => !siteFilter || !entry.site || entry.site === siteFilter,
    );

    if (!previousEntries.length) {
      notify("No previous-day attendance was found for this site.", "warn");
      return;
    }

    const currentSavedIds = new Set(
      timesheets.filter((entry) => entry.work_date === workDate).map((entry) => entry.employee_id),
    );
    const copiedIds = previousEntries
      .map((entry) => entry.employee_id)
      .filter((employeeId) => activeEmployees.some((employee) => employee.id === employeeId));
    const overwritten = copiedIds.filter(
      (employeeId) => currentSavedIds.has(employeeId) || dirtyIds.has(employeeId),
    ).length;
    const confirmText =
      `Copy ${previousDate} attendance to ${workDate} for ${copiedIds.length} employee(s)?` +
      (overwritten
        ? ` This will replace ${overwritten} existing saved or unsaved row(s) for the selected site.`
        : "");
    if (!window.confirm(confirmText)) return;

    const nextRows = { ...rows };
    for (const entry of previousEntries) {
      const employee = activeEmployees.find((item) => item.id === entry.employee_id);
      if (!employee) continue;
      nextRows[employee.id] = {
        employeeId: employee.id,
        site: entry.site || siteFilter,
        foreman: entry.foreman || "",
        status: entry.status,
        inTime: entry.in_time ?? "",
        outTime: entry.out_time ?? "",
        breakHours: String(entry.break_hours ?? 0),
        notes: entry.remarks ?? "",
        overtime: String(entry.overtime_hours ?? 0),
      };
    }
    setRows(nextRows);
    setDirtyIds((dirty) => new Set([...dirty, ...copiedIds]));
    notify(
      `Copied ${copiedIds.length} attendance row(s) from ${previousDate} to ${workDate}. Review and save them.`,
    );
  };

  const loadCrew = () => {
    const destination = filteredEmployees.slice(0, 25).map((employee) => employee.id);
    setSelectedIds(destination);
    setSelectedEmployeeId(destination[0] ?? null);
    notify(`${destination.length} employee(s) loaded into the current crew.`);
  };

  const selectedWithinRows = currentRecords.filter(({ employee }) =>
    selectedIds.includes(employee.id),
  );
  const hasSelection = selectedIds.length > 0;

  return (
    <section className="space-y-4">
      <div
        className={card + " flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <Clock3 size={20} />
          </div>
          <div>
            <h2 className="font-display text-xl font-extrabold text-navy">Attendance workbench</h2>
            <p className="text-xs text-muted-foreground">
              Crew-based daily entry for 300+ employees
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Date
            <input
              type="date"
              value={workDate}
              onChange={(event) => {
                if (confirmDiscard()) {
                  setRows({});
                  setWorkDate(event.target.value);
                }
              }}
              className={input + " mt-1 min-w-[160px]"}
            />
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Site
            <input
              value={siteFilter}
              onChange={(event) => {
                if (confirmDiscard()) setSiteFilter(event.target.value);
              }}
              list="site-options"
              className={input + " mt-1 min-w-[160px]"}
            />
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Crew
            <select
              value={crewName}
              onChange={(event) => {
                if (confirmDiscard()) setCrewName(event.target.value);
              }}
              className={input + " mt-1 min-w-[140px]"}
            >
              <option value="All foremen">All foremen</option>
              {[
                ...new Set(
                  timesheets
                    .filter((entry) => entry.work_date === workDate)
                    .map((entry) => entry.foreman)
                    .filter(Boolean),
                ),
              ]
                .sort()
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      <div className={card + " p-3"}>
        <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
          <aside className="space-y-4 border-r border-border pr-0 xl:pr-3">
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Operations
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={copyPreviousDay}
                  className={btnOutline + " justify-center px-2 py-2 text-xs"}
                >
                  <Copy size={14} /> Copy previous day
                </button>
                <button
                  type="button"
                  onClick={loadCrew}
                  className={btnOutline + " justify-center px-2 py-2 text-xs"}
                >
                  <Users size={14} /> Load crew
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkAction("present")}
                  className={btnOutline + " justify-center px-2 py-2 text-xs"}
                >
                  <Check size={14} /> Mark present
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkAction("absent")}
                  className={btnOutline + " justify-center px-2 py-2 text-xs"}
                >
                  <X size={14} /> Mark absent
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Filter</p>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search employee"
                  className={input + " pl-8"}
                />
              </div>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value as AttendanceFilter)}
                className={input}
              >
                <option value="All">All statuses</option>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="LEAVE">Leave</option>
                <option value="HOLIDAY">Holiday</option>
                <option value="WEEKLY_OFF">Weekly off</option>
                <option value="HALF_DAY">Half day</option>
                <option value="Review">Review</option>
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Exceptions
              </p>
              <div className="space-y-2 rounded-lg border border-border bg-navy-soft p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span>Missing</span>
                  <strong>{exceptionSummary.missing}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Absent</span>
                  <strong>{exceptionSummary.absent}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Leave</span>
                  <strong>{exceptionSummary.leave}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Overtime</span>
                  <strong>{exceptionSummary.overtime}</strong>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="flex items-center justify-between font-bold text-navy">
                <span>Crew</span>
                <strong>{crewName}</strong>
              </div>
              <p className="mt-2 text-muted-foreground">
                {filteredEmployees.length} active workers
              </p>
            </div>
          </aside>

          <main className="min-w-0 overflow-hidden">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-navy-soft text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={
                          selectedIds.length > 0 && selectedIds.length === filteredEmployees.length
                        }
                        onChange={() =>
                          setSelectedIds(
                            selectedIds.length === filteredEmployees.length
                              ? []
                              : filteredEmployees.map((employee) => employee.id),
                          )
                        }
                      />
                    </th>
                    <th className="px-2 py-3">Employee</th>
                    <th className="px-2 py-3">ID</th>
                    <th className="px-2 py-3">Trade</th>
                    <th className="px-2 py-3">Site</th>
                    <th className="px-2 py-3">Foreman</th>
                    <th className="px-2 py-3">Status</th>
                    <th className="px-2 py-3">In</th>
                    <th className="px-2 py-3">Out</th>
                    <th className="px-2 py-3">Break</th>
                    <th className="px-2 py-3">Regular hrs</th>
                    <th className="px-2 py-3">OT</th>
                    <th className="px-2 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((employee) => {
                    const row = rows[employee.id] ?? initialRow(employee, workDate, siteFilter, "");
                    const worked = row.status === "PRESENT" || row.status === "HALF_DAY";
                    const isSelected = selectedIds.includes(employee.id);
                    const isException = exceptionCount(row) > 0;
                    return (
                      <tr
                        key={employee.id}
                        className={`border-t border-border ${isSelected ? "bg-navy-soft" : "bg-card hover:bg-navy-soft/50"} ${isException ? "border-l-2 border-l-danger" : ""}`}
                        onClick={() => setSelectedEmployeeId(employee.id)}
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelection(employee.id)}
                          />
                        </td>
                        <td className="px-2 py-2 font-semibold text-navy">{employee.name}</td>
                        <td className="px-2 py-2 font-mono text-[11px] text-slate-500">
                          {employee.id_number || employee.id}
                        </td>
                        <td className="px-2 py-2">{employee.trade}</td>
                        <td className="px-2 py-2">
                          <input
                            value={row.site || siteFilter}
                            onChange={(event) =>
                              updateRow(employee.id, { site: event.target.value })
                            }
                            className={inputSm + " min-w-[110px]"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.foreman}
                            onChange={(event) =>
                              updateRow(employee.id, { foreman: event.target.value })
                            }
                            list="foreman-options"
                            className={inputSm + " min-w-[110px]"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={row.status}
                            onChange={(event) =>
                              updateRow(employee.id, {
                                status: event.target.value as AttendanceStatus,
                              })
                            }
                            className={inputSm + " min-w-[100px]"}
                          >
                            <option value="PRESENT">Present</option>
                            <option value="ABSENT">Absent</option>
                            <option value="LEAVE">Leave</option>
                            <option value="HOLIDAY">Holiday</option>
                            <option value="WEEKLY_OFF">Weekly off</option>
                            <option value="HALF_DAY">Half day</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="time"
                            value={row.inTime}
                            disabled={!worked}
                            onChange={(event) =>
                              updateRow(employee.id, { inTime: event.target.value })
                            }
                            className={inputSm + " min-w-[90px] disabled:opacity-50"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="time"
                            value={row.outTime}
                            disabled={!worked}
                            onChange={(event) =>
                              updateRow(employee.id, { outTime: event.target.value })
                            }
                            className={inputSm + " min-w-[90px] disabled:opacity-50"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={row.breakHours}
                            disabled={!worked}
                            onChange={(event) =>
                              updateRow(employee.id, { breakHours: event.target.value })
                            }
                            className={inputSm + " min-w-[70px] disabled:opacity-50"}
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-navy">
                          {regularHoursFor(row).toFixed(2)}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={row.overtime}
                            disabled={!worked}
                            onChange={(event) =>
                              updateRow(employee.id, { overtime: event.target.value })
                            }
                            className={inputSm + " min-w-[65px] disabled:opacity-50"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.notes}
                            onChange={(event) =>
                              updateRow(employee.id, { notes: event.target.value })
                            }
                            className={inputSm + " min-w-[120px]"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </main>

          <aside className="space-y-3 border-t border-border pt-3 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
            {selectedEmployee && selectedRow ? (
              <>
                <div className="rounded-lg border border-border bg-navy-soft p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Selected employee
                      </p>
                      <h3 className="mt-1 text-base font-extrabold text-navy">
                        {selectedEmployee.name}
                      </h3>
                    </div>
                    <span className="rounded-full border border-border bg-card px-2 py-1 text-[10px] font-bold uppercase text-slate-600">
                      {selectedRow.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>
                      <span className="font-bold text-slate-500">Trade</span>
                      <div>{selectedEmployee.trade}</div>
                    </div>
                    <div>
                      <span className="font-bold text-slate-500">Rate</span>
                      <div>{selectedEmployee.hourly_rate.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="font-bold text-slate-500">Site</span>
                      <div>{selectedRow.site || "—"}</div>
                    </div>
                    <div>
                      <span className="font-bold text-slate-500">Foreman</span>
                      <div>{selectedRow.foreman || "—"}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3 text-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Current day
                  </p>
                  <div className="mt-2 space-y-1 text-slate-600">
                    <div className="flex justify-between">
                      <span>Hours</span>
                      <strong className="text-navy">
                        {regularHoursFor(selectedRow).toFixed(2)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>OT</span>
                      <strong>{overtimeFor(selectedRow).toFixed(2)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Break</span>
                      <strong>{selectedRow.breakHours}</strong>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3 text-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Quick actions
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateRow(selectedEmployee.id, { status: "PRESENT" })}
                      className={btnOutline + " justify-center px-2 py-2 text-[11px]"}
                    >
                      Present
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRow(selectedEmployee.id, { status: "ABSENT" })}
                      className={btnOutline + " justify-center px-2 py-2 text-[11px]"}
                    >
                      Absent
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRow(selectedEmployee.id, { status: "LEAVE" })}
                      className={btnOutline + " justify-center px-2 py-2 text-[11px]"}
                    >
                      Leave
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateRow(selectedEmployee.id, { inTime: "08:00", outTime: "17:00" })
                      }
                      className={btnOutline + " justify-center px-2 py-2 text-[11px]"}
                    >
                      Shift
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Select a row to inspect attendance details.
              </div>
            )}
          </aside>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle size={14} className="text-warn" />
          {timesheetsQuery.error
            ? `Attendance load issue: ${timesheetsQuery.error.message}`
            : timesheetsQuery.isLoading
              ? `Loading attendance for ${workDate}…`
              : `Showing ${currentRecords.length} rows for ${workDate}`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyBulkAction("in", "08:00")}
            className={btnOutline + " justify-center px-3 py-2 text-xs"}
          >
            Apply In
          </button>
          <button
            type="button"
            onClick={() => applyBulkAction("out", "17:00")}
            className={btnOutline + " justify-center px-3 py-2 text-xs"}
          >
            Apply Out
          </button>
          <button
            type="button"
            onClick={() => applyBulkAction("break", "1")}
            className={btnOutline + " justify-center px-3 py-2 text-xs"}
          >
            Apply Break
          </button>
          <button
            type="button"
            onClick={() => applyBulkAction("overtime", "2")}
            className={btnOutline + " justify-center px-3 py-2 text-xs"}
          >
            Apply OT
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAll()}
            className={btnGold + " justify-center px-4 py-2 text-xs"}
          >
            <HardHat size={15} /> {saving ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      <datalist id="site-options">
        {siteOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="foreman-options">
        {[
          ...new Set(
            timesheets
              .map((entry) => entry.foreman)
              .filter(Boolean)
              .concat(
                employees.filter((entry) => entry.trade === "FORMAN").map((entry) => entry.name),
              ),
          ),
        ].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </section>
  );
}
