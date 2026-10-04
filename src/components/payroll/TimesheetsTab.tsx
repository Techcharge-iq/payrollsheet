import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  HardHat,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { useTimesheetsForDate, type TimesheetRecord } from "@/lib/payroll-data";
import { btnGold, btnIcon, btnOutline, card, input, select } from "./ui";

interface Props {
  employees: Employee[];
  saving: boolean;
  onSave: (
    rows: Omit<TimesheetRecord, "id" | "created_at" | "total_hours" | "regular_hours">[],
  ) => Promise<void>;
  notify: (message: string, tone?: "ok" | "warn") => void;
  onDirtyChange?: (dirty: boolean) => void;
}

type AttendanceStatus = TimesheetRecord["status"];

interface AttendanceDraft {
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
  breakHours: string;
  overtime: string;
  notes: string;
}

interface AttendanceBatch {
  key: string;
  site: string;
  foreman: string;
  entries: TimesheetRecord[];
}

const ATTENDANCE_STATUSES: Array<{ value: AttendanceStatus; label: string }> = [
  { value: "PRESENT", label: "Present" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "ABSENT", label: "Absent" },
  { value: "LEAVE", label: "Leave" },
  { value: "HOLIDAY", label: "Holiday" },
  { value: "WEEKLY_OFF", label: "Weekly off" },
];

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previousCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function batchKey(site: string, foreman: string) {
  return JSON.stringify([site.trim().toLowerCase(), foreman.trim().toLowerCase()]);
}

function defaultAttendance(): AttendanceDraft {
  return {
    status: "PRESENT",
    inTime: "08:00",
    outTime: "17:00",
    breakHours: "1",
    overtime: "0",
    notes: "",
  };
}

function attendanceFromRecord(entry: TimesheetRecord): AttendanceDraft {
  return {
    status: entry.status,
    inTime: entry.in_time?.slice(0, 5) ?? "",
    outTime: entry.out_time?.slice(0, 5) ?? "",
    breakHours: String(entry.break_hours ?? 0),
    overtime: String(entry.overtime_hours ?? 0),
    notes: entry.remarks ?? "",
  };
}

function batchGroups(entries: TimesheetRecord[]): AttendanceBatch[] {
  const groups = new Map<string, AttendanceBatch>();
  for (const entry of entries) {
    const key = batchKey(entry.site, entry.foreman);
    const group = groups.get(key) ?? {
      key,
      site: entry.site,
      foreman: entry.foreman,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.site.localeCompare(b.site) || a.foreman.localeCompare(b.foreman),
  );
}

function worked(status: AttendanceStatus) {
  return status === "PRESENT" || status === "HALF_DAY";
}

function hoursFor(draft: AttendanceDraft) {
  if (!worked(draft.status) || !draft.inTime || !draft.outTime) return 0;
  const [inHour, inMinute] = draft.inTime.split(":").map(Number);
  const [outHour, outMinute] = draft.outTime.split(":").map(Number);
  const start = inHour! * 60 + inMinute!;
  const end = outHour! * 60 + outMinute!;
  if (end <= start) return 0;
  return Math.max(0, (end - start) / 60 - (Number(draft.breakHours) || 0));
}

export function TimesheetsTab({ employees, saving, onSave, notify, onDirtyChange }: Props) {
  const [workDate, setWorkDate] = useState(today);
  const previousDate = previousCalendarDate(workDate);
  const timesheetsQuery = useTimesheetsForDate(workDate);
  const previousTimesheetsQuery = useTimesheetsForDate(previousDate);
  const timesheets = useMemo(() => timesheetsQuery.data ?? [], [timesheetsQuery.data]);
  const previousEntries = useMemo(
    () => previousTimesheetsQuery.data ?? [],
    [previousTimesheetsQuery.data],
  );
  const [site, setSite] = useState("");
  const [foreman, setForeman] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [attendance, setAttendance] = useState<Record<number, AttendanceDraft>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((employee) => employee.status === "Active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );
  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );
  const savedBatches = useMemo(() => batchGroups(timesheets), [timesheets]);
  const previousBatches = useMemo(() => batchGroups(previousEntries), [previousEntries]);
  const selectedEmployees = useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const employee = employeeById.get(id);
        return employee ? [employee] : [];
      }),
    [employeeById, selectedIds],
  );
  const filteredPickerEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    return activeEmployees.filter((employee) => {
      if (
        query &&
        ![employee.name, employee.trade, employee.id_number, String(employee.id)]
          .join(" ")
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      const assigned = timesheets.find((entry) => entry.employee_id === employee.id);
      return (
        !assigned ||
        (editingKey !== null && batchKey(assigned.site, assigned.foreman) === editingKey)
      );
    });
  }, [activeEmployees, editingKey, employeeSearch, timesheets]);
  const duplicateAssignments = useMemo(
    () =>
      selectedEmployees.flatMap((employee) => {
        const assigned = timesheets.find((entry) => entry.employee_id === employee.id);
        if (
          !assigned ||
          (editingKey !== null && batchKey(assigned.site, assigned.foreman) === editingKey)
        ) {
          return [];
        }
        return [{ employee, assigned }];
      }),
    [editingKey, selectedEmployees, timesheets],
  );
  const selectedCount = selectedIds.length;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const protectUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnload);
    return () => window.removeEventListener("beforeunload", protectUnload);
  }, [dirty]);

  const resetForm = () => {
    setSite("");
    setForeman("");
    setSelectedIds([]);
    setAttendance({});
    setEditingKey(null);
    setDirty(false);
    setEmployeeSearch("");
    setEmployeePickerOpen(false);
  };

  const confirmDiscard = () => {
    if (!dirty || window.confirm("Discard unsaved attendance batch changes?")) {
      resetForm();
      return true;
    }
    return false;
  };

  const startNewBatch = () => {
    if (dirty && !confirmDiscard()) return;
    resetForm();
    setCopyPickerOpen(false);
  };

  const editBatch = (batch: AttendanceBatch) => {
    if (dirty && !confirmDiscard()) return;
    setSite(batch.site);
    setForeman(batch.foreman);
    setEditingKey(batch.key);
    setSelectedIds(batch.entries.map((entry) => entry.employee_id));
    setAttendance(
      Object.fromEntries(
        batch.entries.map((entry) => [entry.employee_id, attendanceFromRecord(entry)]),
      ),
    );
    setDirty(false);
    setCopyPickerOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleEmployee = (employee: Employee) => {
    const isSelected = selectedIds.includes(employee.id);
    if (
      isSelected &&
      editingKey &&
      timesheets.some(
        (entry) =>
          entry.employee_id === employee.id && batchKey(entry.site, entry.foreman) === editingKey,
      )
    ) {
      notify(
        "Existing batch members stay assigned while editing; update the attendance details instead.",
        "warn",
      );
      return;
    }
    if (!isSelected) {
      const assigned = timesheets.find((entry) => entry.employee_id === employee.id);
      if (assigned && (!editingKey || batchKey(assigned.site, assigned.foreman) !== editingKey)) {
        notify(
          `${employee.name} is already assigned to ${assigned.site} with ${assigned.foreman} on this date.`,
          "warn",
        );
        return;
      }
    }

    setSelectedIds((current) =>
      isSelected ? current.filter((id) => id !== employee.id) : [...current, employee.id],
    );
    if (!isSelected) {
      const existing = timesheets.find((entry) => entry.employee_id === employee.id);
      setAttendance((current) => ({
        ...current,
        [employee.id]: existing ? attendanceFromRecord(existing) : defaultAttendance(),
      }));
    }
    setDirty(true);
  };

  const updateAttendance = (employeeId: number, patch: Partial<AttendanceDraft>) => {
    setAttendance((current) => {
      const next = { ...(current[employeeId] ?? defaultAttendance()), ...patch };
      if (patch.status && !worked(patch.status)) {
        next.inTime = "";
        next.outTime = "";
        next.breakHours = "0";
        next.overtime = "0";
      }
      return { ...current, [employeeId]: next };
    });
    setDirty(true);
  };

  const loadCopiedBatch = (batch: AttendanceBatch) => {
    if (dirty && !confirmDiscard()) return;
    setSite(batch.site);
    setForeman(batch.foreman);
    setEditingKey(null);
    setSelectedIds(batch.entries.map((entry) => entry.employee_id));
    setAttendance(
      Object.fromEntries(
        batch.entries.map((entry) => [entry.employee_id, attendanceFromRecord(entry)]),
      ),
    );
    setDirty(true);
    setCopyPickerOpen(false);
    notify(
      `Copied ${batch.entries.length} worker(s) from ${previousDate}. Review the batch and save it for ${workDate}.`,
    );
  };

  const saveBatch = async () => {
    const cleanSite = site.trim();
    const cleanForeman = foreman.trim();
    if (!cleanSite || !cleanForeman) {
      notify("Enter both a site and a foreman before saving the attendance batch.", "warn");
      return;
    }
    if (!selectedIds.length) {
      notify("Select at least one employee for this attendance batch.", "warn");
      return;
    }
    if (duplicateAssignments.length) {
      notify(
        `${duplicateAssignments.map(({ employee }) => employee.name).join(", ")} already have attendance at another site or foreman on this date. Edit their existing batch first.`,
        "warn",
      );
      return;
    }

    const invalid = selectedEmployees.filter((employee) => {
      const row = attendance[employee.id] ?? defaultAttendance();
      if (!worked(row.status)) return false;
      const start = row.inTime.split(":").map(Number);
      const end = row.outTime.split(":").map(Number);
      const startMinutes = start[0]! * 60 + start[1]!;
      const endMinutes = end[0]! * 60 + end[1]!;
      const breakHours = Number(row.breakHours);
      const overtime = Number(row.overtime);
      const shiftHours = (endMinutes - startMinutes) / 60;
      return (
        !row.inTime ||
        !row.outTime ||
        endMinutes <= startMinutes ||
        !Number.isFinite(breakHours) ||
        breakHours < 0 ||
        breakHours > shiftHours ||
        !Number.isFinite(overtime) ||
        overtime < 0 ||
        overtime > hoursFor(row)
      );
    });
    if (invalid.length) {
      notify(
        `Check the time, break, and overtime values for ${invalid.map((employee) => employee.name).join(", ")}.`,
        "warn",
      );
      return;
    }

    const payload = selectedEmployees.map((employee) => {
      const row = attendance[employee.id] ?? defaultAttendance();
      const doesWork = worked(row.status);
      return {
        employee_id: employee.id,
        site: cleanSite,
        foreman: cleanForeman,
        work_date: workDate,
        status: row.status,
        in_time: doesWork ? row.inTime : null,
        out_time: doesWork ? row.outTime : null,
        break_hours: doesWork ? Number(row.breakHours) || 0 : 0,
        overtime_hours: doesWork ? Number(row.overtime) || 0 : 0,
        remarks: row.notes.trim() || null,
      } satisfies Omit<TimesheetRecord, "id" | "created_at" | "total_hours" | "regular_hours">;
    });

    try {
      await onSave(payload);
      resetForm();
      notify(
        `${payload.length} employee attendance record(s) saved for ${cleanSite} · ${cleanForeman}.`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save this attendance batch.",
        "warn",
      );
    }
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
    if (!previousBatches.length) {
      notify(`No attendance batches were found for ${previousDate}.`, "warn");
      return;
    }
    if (dirty && !confirmDiscard()) return;
    setCopyPickerOpen((open) => !open);
  };

  return (
    <section className="space-y-5">
      <div className={`${card} flex flex-wrap items-center justify-between gap-4 p-4`}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <CalendarDays size={20} />
          </div>
          <div>
            <h2 className="font-display text-xl font-extrabold text-navy">Daily attendance</h2>
            <p className="text-xs text-muted-foreground">
              Create a site and foreman batch, then choose the workers for that day.
            </p>
          </div>
        </div>
        <label className="block min-w-44 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Attendance date
          <input
            type="date"
            value={workDate}
            onChange={(event) => {
              if (!event.target.value || event.target.value === workDate || !confirmDiscard())
                return;
              setWorkDate(event.target.value);
              setCopyPickerOpen(false);
            }}
            className={`${input} mt-1`}
          />
        </label>
      </div>

      {timesheetsQuery.error && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          <AlertTriangle size={15} /> Could not load attendance: {timesheetsQuery.error.message}
        </p>
      )}

      {timesheetsQuery.isLoading ? (
        <div className={`${card} p-8 text-center text-sm text-muted-foreground`}>
          Loading attendance for {workDate}…
        </div>
      ) : (
        <>
          <div className={`${card} space-y-4 p-4 sm:p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-navy">
                  {editingKey ? "Edit attendance batch" : "Create attendance batch"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  One employee can only be assigned to one site per day.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyPreviousDay} className={btnOutline}>
                  <Copy size={15} /> Copy previous day
                </button>
                {editingKey && (
                  <button type="button" onClick={startNewBatch} className={btnOutline}>
                    <Plus size={15} /> New batch
                  </button>
                )}
              </div>
            </div>

            {copyPickerOpen && (
              <div className="rounded-xl border border-gold/40 bg-gold/10 p-3">
                <p className="mb-2 text-xs font-bold text-navy">
                  Choose a batch from {previousDate} to copy. It will be staged for {workDate};
                  nothing is saved until you press Save batch.
                </p>
                <div className="flex flex-wrap gap-2">
                  {previousBatches.map((batch) => (
                    <button
                      key={batch.key}
                      type="button"
                      onClick={() => loadCopiedBatch(batch)}
                      className={btnOutline}
                    >
                      <Copy size={14} />
                      {batch.site} · {batch.foreman} · {batch.entries.length} workers
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Site / project
                <input
                  value={site}
                  onChange={(event) => {
                    setSite(event.target.value);
                    setDirty(true);
                  }}
                  placeholder="Enter or choose a site"
                  list="attendance-sites"
                  className={`${input} mt-1`}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Foreman
                <input
                  value={foreman}
                  onChange={(event) => {
                    setForeman(event.target.value);
                    setDirty(true);
                  }}
                  placeholder="Enter or choose a foreman"
                  list="attendance-foremen"
                  className={`${input} mt-1`}
                />
              </label>
            </div>

            <datalist id="attendance-sites">
              {[...new Set(timesheets.map((entry) => entry.site).filter(Boolean))]
                .sort()
                .map((name) => (
                  <option key={name} value={name} />
                ))}
            </datalist>
            <datalist id="attendance-foremen">
              {[
                ...new Set([
                  ...timesheets.map((entry) => entry.foreman).filter(Boolean),
                  ...employees
                    .filter((employee) => employee.trade === "FORMAN")
                    .map((employee) => employee.name),
                ]),
              ]
                .sort()
                .map((name) => (
                  <option key={name} value={name} />
                ))}
            </datalist>

            <div className="relative">
              <p className="mb-1 text-xs font-semibold text-slate-600">Employees for this batch</p>
              <button
                type="button"
                onClick={() => setEmployeePickerOpen((open) => !open)}
                aria-expanded={employeePickerOpen}
                className={`${input} flex items-center justify-between text-left`}
              >
                <span>
                  {selectedCount
                    ? `${selectedCount} employee${selectedCount === 1 ? "" : "s"} selected`
                    : "Select employees…"}
                </span>
                <ChevronDown size={16} />
              </button>
              {employeePickerOpen && (
                <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-xl">
                  <div className="relative mb-2">
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      autoFocus
                      value={employeeSearch}
                      onChange={(event) => setEmployeeSearch(event.target.value)}
                      placeholder="Find employee by name, trade or ID"
                      className={`${input} pl-9`}
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {activeEmployees
                      .filter((employee) => {
                        const query = employeeSearch.trim().toLowerCase();
                        return (
                          !query ||
                          [employee.name, employee.trade, employee.id_number, String(employee.id)]
                            .join(" ")
                            .toLowerCase()
                            .includes(query)
                        );
                      })
                      .map((employee) => {
                        const checked = selectedIds.includes(employee.id);
                        const assigned = timesheets.find(
                          (entry) => entry.employee_id === employee.id,
                        );
                        const assignedOutsideBatch =
                          assigned &&
                          (!editingKey || batchKey(assigned.site, assigned.foreman) !== editingKey);
                        const lockedInBatch =
                          checked &&
                          editingKey !== null &&
                          assigned &&
                          batchKey(assigned.site, assigned.foreman) === editingKey;
                        return (
                          <label
                            key={employee.id}
                            className={`flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-sm ${
                              assignedOutsideBatch
                                ? "cursor-not-allowed opacity-50"
                                : "cursor-pointer hover:bg-navy-soft"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={Boolean(
                                (assignedOutsideBatch && !checked) || lockedInBatch,
                              )}
                              onChange={() => toggleEmployee(employee)}
                              className="h-4 w-4 accent-[var(--navy)]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-navy">
                                {employee.name}
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                {employee.trade} · ID {employee.id_number || employee.id}
                              </span>
                            </span>
                            {assignedOutsideBatch && (
                              <span className="max-w-36 text-right text-[10px] font-semibold text-warn">
                                Assigned: {assigned.site} · {assigned.foreman}
                              </span>
                            )}
                            {lockedInBatch && (
                              <span className="text-[10px] font-bold text-money">
                                In this batch
                              </span>
                            )}
                          </label>
                        );
                      })}
                    {filteredPickerEmployees.length === 0 && (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                        No available employees match. Workers already assigned today are locked to
                        their existing site batch.
                      </p>
                    )}
                  </div>
                  <div className="mt-2 flex justify-end border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEmployeePickerOpen(false);
                        setEmployeeSearch("");
                      }}
                      className={btnOutline}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>

            {duplicateAssignments.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {duplicateAssignments
                  .map(
                    ({ employee, assigned }) =>
                      `${employee.name} is already assigned to ${assigned.site} · ${assigned.foreman}`,
                  )
                  .join("; ")}
              </p>
            )}

            {selectedEmployees.length > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Daily attendance · {selectedEmployees.length} worker(s)
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAttendance((current) => {
                        const next = { ...current };
                        selectedEmployees.forEach((employee) => {
                          const row = next[employee.id] ?? defaultAttendance();
                          next[employee.id] = {
                            ...row,
                            status: "PRESENT",
                            inTime: "08:00",
                            outTime: "17:00",
                            breakHours: "1",
                          };
                        });
                        return next;
                      });
                      setDirty(true);
                    }}
                    className={btnOutline}
                  >
                    <Check size={14} /> Set all present · 08:00–17:00
                  </button>
                </div>
                {selectedEmployees.map((employee) => {
                  const row = attendance[employee.id] ?? defaultAttendance();
                  const workedToday = worked(row.status);
                  const assignedExisting =
                    editingKey !== null &&
                    timesheets.some(
                      (entry) =>
                        entry.employee_id === employee.id &&
                        batchKey(entry.site, entry.foreman) === editingKey,
                    );
                  return (
                    <article
                      key={employee.id}
                      className="rounded-xl border border-border bg-card p-3 sm:p-4"
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy-soft text-navy">
                            <Users size={16} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="truncate text-sm font-bold text-navy">
                              {employee.name}
                            </h4>
                            <p className="text-[11px] text-muted-foreground">
                              {employee.trade} · {employee.id_number || `ID ${employee.id}`}
                            </p>
                          </div>
                        </div>
                        {!assignedExisting && (
                          <button
                            type="button"
                            onClick={() => toggleEmployee(employee)}
                            className={btnIcon}
                            aria-label={`Remove ${employee.name} from this unsaved batch`}
                            title="Remove from batch"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Status
                          <select
                            value={row.status}
                            onChange={(event) =>
                              updateAttendance(employee.id, {
                                status: event.target.value as AttendanceStatus,
                              })
                            }
                            className={`${select} mt-1`}
                          >
                            {ATTENDANCE_STATUSES.map((status) => (
                              <option key={status.value} value={status.value}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          In
                          <input
                            type="time"
                            value={row.inTime}
                            disabled={!workedToday}
                            onChange={(event) =>
                              updateAttendance(employee.id, { inTime: event.target.value })
                            }
                            className={`${input} mt-1 disabled:opacity-50`}
                          />
                        </label>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Out
                          <input
                            type="time"
                            value={row.outTime}
                            disabled={!workedToday}
                            onChange={(event) =>
                              updateAttendance(employee.id, { outTime: event.target.value })
                            }
                            className={`${input} mt-1 disabled:opacity-50`}
                          />
                        </label>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Break (hrs)
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={row.breakHours}
                            disabled={!workedToday}
                            onChange={(event) =>
                              updateAttendance(employee.id, { breakHours: event.target.value })
                            }
                            className={`${input} mt-1 disabled:opacity-50`}
                          />
                        </label>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Overtime (hrs)
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={row.overtime}
                            disabled={!workedToday}
                            onChange={(event) =>
                              updateAttendance(employee.id, { overtime: event.target.value })
                            }
                            className={`${input} mt-1 disabled:opacity-50`}
                          />
                        </label>
                        <div className="flex flex-col justify-end rounded-lg bg-navy-soft px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Regular hrs
                          </span>
                          <strong className="mt-1 text-sm text-navy">
                            {Math.max(0, hoursFor(row) - (Number(row.overtime) || 0)).toFixed(2)}
                          </strong>
                        </div>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:col-span-2 lg:col-span-6">
                          Notes
                          <input
                            value={row.notes}
                            onChange={(event) =>
                              updateAttendance(employee.id, { notes: event.target.value })
                            }
                            placeholder="Optional attendance note"
                            className={`${input} mt-1`}
                          />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {selectedCount
                  ? `${selectedCount} employee(s) · ${site.trim() || "Site not set"} · ${foreman.trim() || "Foreman not set"}`
                  : "Choose a site, foreman, and one or more employees to begin."}
              </p>
              <div className="flex gap-2">
                {dirty && (
                  <button type="button" onClick={startNewBatch} className={btnOutline}>
                    <X size={15} /> Cancel changes
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving || !selectedCount || Boolean(duplicateAssignments.length)}
                  onClick={() => void saveBatch()}
                  className={btnGold}
                >
                  <HardHat size={15} />{" "}
                  {saving ? "Saving…" : editingKey ? "Save changes" : "Save batch"}
                </button>
              </div>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-bold text-navy">Saved batches</h3>
                <p className="text-xs text-muted-foreground">
                  {timesheets.length} worker record(s) in {savedBatches.length} site / foreman
                  batch(es) for {workDate}.
                </p>
              </div>
              <button type="button" onClick={startNewBatch} className={btnGold}>
                <Plus size={15} /> Create another batch
              </button>
            </div>
            {savedBatches.length === 0 ? (
              <div className={`${card} p-8 text-center`}>
                <Clock3 size={26} className="mx-auto text-slate-400" />
                <p className="mt-2 text-sm font-semibold text-navy">
                  No attendance batches saved for this date.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create the first batch above, or copy a batch from the previous day.
                </p>
              </div>
            ) : (
              savedBatches.map((batch) => {
                const present = batch.entries.filter((entry) => worked(entry.status)).length;
                const hours = batch.entries.reduce(
                  (sum, entry) => sum + Number(entry.total_hours ?? 0),
                  0,
                );
                return (
                  <article
                    key={batch.key}
                    className={`${card} flex flex-wrap items-center gap-3 p-4`}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-soft text-navy">
                      <Users size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-bold text-navy">
                        {batch.site} <span className="font-normal text-slate-400">·</span>{" "}
                        {batch.foreman}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {batch.entries.length} employee(s) · {present} present · {hours.toFixed(2)}{" "}
                        recorded hours
                      </p>
                      <p className="mt-1 truncate text-[11px] text-slate-500">
                        {batch.entries
                          .map(
                            (entry) =>
                              employeeById.get(entry.employee_id)?.name ??
                              `ID ${entry.employee_id}`,
                          )
                          .join(", ")}
                      </p>
                    </div>
                    <button type="button" onClick={() => editBatch(batch)} className={btnOutline}>
                      <Pencil size={14} /> Edit batch
                    </button>
                  </article>
                );
              })
            )}
          </section>
        </>
      )}
    </section>
  );
}
