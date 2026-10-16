import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  ChevronDown,
  Copy,
  MapPin,
  Pencil,
  Plus,
  Search,

  Trash2,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { dbAny } from "@/integrations/supabase/external-client";
import { useTimesheetsForDate, type TimesheetRecord } from "@/lib/payroll-data";
import { useProjects, type Project } from "@/lib/management-data";
import { projectAccessError } from "@/lib/project-access";
import { MonthlyAttendanceDialog } from "./MonthlyAttendanceDialog";
import { TimeControl } from "./TimeControl";
import { btnGold, btnOutline, card, input, select } from "./ui";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  employees: Employee[];
  role: string;
  currentUserId: string;
  saving: boolean;
  onSave: (
    rows: Omit<TimesheetRecord, "id" | "created_at" | "total_hours" | "regular_hours">[],
  ) => Promise<void>;
  onOpenWorkforce: () => void;
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
  manualHours: string;
  notes: string;
}

type AttendanceColumn = "inTime" | "outTime" | "breakHours" | "overtime";

const ATTENDANCE_COLUMNS: Array<{ value: AttendanceColumn; label: string }> = [
  { value: "inTime", label: "In time" },
  { value: "outTime", label: "Out time" },
  { value: "breakHours", label: "Break" },
  { value: "overtime", label: "Overtime" },
];

const SHIFT_PRESETS = [
  { start: "08:00", end: "17:00", label: "Day" },
  { start: "07:00", end: "16:00", label: "Early" },
  { start: "12:00", end: "21:00", label: "Late" },
];

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
    manualHours: "8",
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
    manualHours: String(entry.total_hours ?? 0),
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

const SUMMARY_TONES: Record<string, string> = {
  Marked: "bg-amber-50 text-amber-600",
  Present: "bg-emerald-50 text-emerald-600",
  "Total hours": "bg-blue-50 text-blue-600",
  "Selected employees": "bg-slate-100 text-slate-600",
};

function AttendanceSummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
}) {
  return (
    <article className={`${card} flex min-w-0 items-center justify-between gap-2 px-3 py-2.5`}>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 truncate font-display text-lg font-extrabold tabular-nums text-navy">
          {value}
          {label === "Total hours" ? " hrs" : label === "Selected employees" ? " employees" : ""}
        </p>
      </div>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${SUMMARY_TONES[label] ?? "bg-blue-50 text-blue-600"}`}
      >
        <Icon size={16} aria-hidden="true" />
      </span>
    </article>
  );
}

function MobileAttendanceCard({
  employee,
  row,
  visibleColumns,
  assignedExisting,
  onSelect,
  onUpdate,
  totalHours,
}: {
  employee: Employee;
  row: AttendanceDraft;
  visibleColumns: Record<AttendanceColumn, boolean>;
  assignedExisting: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<AttendanceDraft>) => void;
  totalHours: number;
}) {
  const workedToday = worked(row.status);
  const statusStyle =
    row.status === "PRESENT"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : row.status === "ABSENT"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : row.status === "HALF_DAY"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : row.status === "LEAVE"
            ? "border-sky-200 bg-sky-50 text-sky-800"
            : "border-slate-200 bg-white text-slate-700";
  const manualEntry = !visibleColumns.inTime || !visibleColumns.outTime;
  const compactField = `${input} h-9 w-full rounded-md px-1.5 py-1 text-center text-xs disabled:opacity-50`;

  return (
    <article className="rounded-xl border border-border bg-white p-2.5 shadow-sm">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked
          disabled={assignedExisting}
          onChange={onSelect}
          aria-label={`Select ${employee.name}`}
          className="h-4 w-4 shrink-0 accent-[var(--navy)] disabled:opacity-50"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy">{employee.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {employee.trade} / {employee.id_number || `ID ${employee.id}`}
          </p>
        </div>
        <select
          value={row.status}
          onChange={(event) => onUpdate({ status: event.target.value as AttendanceStatus })}
          aria-label={`${employee.name} status`}
          className={`${select} h-8 w-auto min-w-24 shrink-0 rounded-md border px-2 py-0 text-[11px] ${statusStyle}`}
        >
          {ATTENDANCE_STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-end gap-1.5">
        {visibleColumns.inTime && (
          <label className="min-w-0 flex-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            In
            <input
              type="time"
              value={row.inTime}
              disabled={!workedToday}
              onChange={(event) => onUpdate({ inTime: event.target.value })}
              aria-label={`${employee.name} clock-in time`}
              className={compactField}
            />
          </label>
        )}
        {visibleColumns.outTime && (
          <label className="min-w-0 flex-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Out
            <input
              type="time"
              value={row.outTime}
              disabled={!workedToday}
              onChange={(event) => onUpdate({ outTime: event.target.value })}
              aria-label={`${employee.name} clock-out time`}
              className={compactField}
            />
          </label>
        )}
        {visibleColumns.breakHours && (
          <label className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Break
            <input
              type="number"
              min="0"
              step="0.25"
              value={row.breakHours}
              disabled={!workedToday}
              onChange={(event) => onUpdate({ breakHours: event.target.value })}
              aria-label={`${employee.name} break hours`}
              className={compactField}
            />
          </label>
        )}
        {visibleColumns.overtime && (
          <label className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            OT
            <input
              type="number"
              min="0"
              step="0.25"
              value={row.overtime}
              disabled={!workedToday}
              onChange={(event) => onUpdate({ overtime: event.target.value })}
              aria-label={`${employee.name} overtime hours`}
              className={compactField}
            />
          </label>
        )}
        {manualEntry ? (
          <label className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Total
            <input
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={row.manualHours}
              disabled={!workedToday}
              onChange={(event) => onUpdate({ manualHours: event.target.value })}
              aria-label={`${employee.name} total hours`}
              className={`${compactField} font-bold`}
            />
          </label>
        ) : (
          <div className="flex h-9 w-16 shrink-0 flex-col items-center justify-center self-end rounded-md bg-slate-50">
            <span className="text-[9px] font-bold uppercase text-slate-500">Total</span>
            <span className="text-xs font-bold tabular-nums text-navy">
              {totalHours.toFixed(2)}
            </span>
          </div>
        )}
      </div>
      <label className="mt-2 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
        Attendance note
        <input
          value={row.notes}
          onChange={(event) => onUpdate({ notes: event.target.value })}
          aria-label={`${employee.name} attendance note`}
          placeholder="Add a note for this shift"
          className={`${input} mt-1 h-10 w-full rounded-md px-2 py-1 text-xs`}
        />
      </label>
    </article>
  );
}

export function TimesheetsTab({
  employees,
  role,
  currentUserId,
  saving,
  onSave,
  onOpenWorkforce,
  notify,
  onDirtyChange,
}: Props) {
  const isMobile = useIsMobile();
  const [workDate, setWorkDate] = useState(today);
  const previousDate = previousCalendarDate(workDate);
  const timesheetsQuery = useTimesheetsForDate(workDate);
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
  const assignmentsQuery = useQuery({
    queryKey: ["employee_site_assignments"],
    queryFn: async (): Promise<
      Array<{
        employee_id: number;
        site: string;
        foreman: string;
        project_id: string | null;
        foreman_user_id: string | null;
        effective_from: string;
        effective_to: string | null;
      }>
    > => {
      const { data, error } = await dbAny
        .from("employee_site_assignments")
        .select("employee_id,site,foreman,project_id,foreman_user_id,effective_from,effective_to");
      if (error) throw new Error(projectAccessError(error, "load"));
      return (data ?? []) as Array<{
        employee_id: number;
        site: string;
        foreman: string;
        project_id: string | null;
        foreman_user_id: string | null;
        effective_from: string;
        effective_to: string | null;
      }>;
    },
  });
  const previousTimesheetsQuery = useTimesheetsForDate(previousDate);
  const timesheets = useMemo(() => timesheetsQuery.data ?? [], [timesheetsQuery.data]);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const foremanOptions = useMemo(() => {
    const options: Array<{
      value: string;
      userId: string | null;
      name: string;
      label: string;
    }> = (foremenQuery.data ?? []).map((user) => ({
      value: user.user_id,
      userId: user.user_id,
      name: user.full_name?.trim() || user.email || "Unnamed foreman",
      label: user.email
        ? `${user.full_name?.trim() || user.email} · ${user.email}`
        : user.full_name || "Unnamed foreman",
    }));
    const knownNames = new Set(options.map((option) => option.name.toLowerCase()));
    const historicalNames = [
      ...timesheets.map((entry) => entry.foreman),
      ...employees
        .filter((employee) => employee.trade === "FORMAN")
        .map((employee) => employee.name),
    ];
    for (const name of historicalNames) {
      const normalized = name.trim().toLowerCase();
      if (!normalized || knownNames.has(normalized)) continue;
      knownNames.add(normalized);
      options.push({ value: `legacy:${name}`, userId: null, name, label: name });
    }
    return options;
  }, [employees, foremenQuery.data, timesheets]);
  const previousEntries = useMemo(
    () => previousTimesheetsQuery.data ?? [],
    [previousTimesheetsQuery.data],
  );
  const [site, setSite] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [foreman, setForeman] = useState("");
  const [selectedForemanId, setSelectedForemanId] = useState<string | null>(null);
  const [projectStatusFilter, setProjectStatusFilter] = useState<"active" | "completed" | "all">(
    "active",
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [attendance, setAttendance] = useState<Record<number, AttendanceDraft>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  const [monthlyAttendanceOpen, setMonthlyAttendanceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkInTime, setBulkInTime] = useState("08:00");
  const [bulkOutTime, setBulkOutTime] = useState("17:00");
  const [bulkBreakHours, setBulkBreakHours] = useState("1");
  const [visibleColumns, setVisibleColumns] = useState<Record<AttendanceColumn, boolean>>({
    inTime: true,
    outTime: true,
    breakHours: true,
    overtime: true,
  });
  const sectionRef = useRef<HTMLElement | null>(null);
  const pendingDateEdit = useRef<{
    batchKey: string | null;
    site: string;
    foreman: string;
    projectId: string | null;
    foremanId: string | null;
  } | null>(null);

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
  const assignedProjects = useMemo(
    () => projects.filter((project) => project.foreman_user_id === currentUserId),
    [currentUserId, projects],
  );
  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.id === selectedProjectId ||
          projectStatusFilter === "all" ||
          (projectStatusFilter === "active" ? project.active : !project.active),
      ),
    [projectStatusFilter, projects, selectedProjectId],
  );
  const visibleForemanProjects = useMemo(
    () =>
      assignedProjects.filter(
        (project) =>
          projectStatusFilter === "all" ||
          (projectStatusFilter === "active" ? project.active : !project.active),
      ),
    [assignedProjects, projectStatusFilter],
  );
  const currentProjectAssignments = useMemo(
    () =>
      (assignmentsQuery.data ?? []).filter(
        (assignment) =>
          assignment.project_id === selectedProjectId &&
          (role !== "foreman" || assignment.foreman_user_id === currentUserId) &&
          assignment.effective_from <= workDate &&
          (!assignment.effective_to || assignment.effective_to >= workDate),
      ),
    [assignmentsQuery.data, currentUserId, role, selectedProjectId, workDate],
  );
  const projectAssignmentIds = useMemo(
    () => new Set(currentProjectAssignments.map((assignment) => assignment.employee_id)),
    [currentProjectAssignments],
  );
  const selectedEmployees = useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const employee = employeeById.get(id);
        return employee ? [employee] : [];
      }),
    [employeeById, selectedIds],
  );
  const filteredAttendanceEmployees = useMemo(() => {
    const query = attendanceSearch.trim().toLowerCase();
    if (!query) return selectedEmployees;
    return selectedEmployees.filter((employee) =>
      [employee.name, employee.trade, employee.id_number, String(employee.id)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [attendanceSearch, selectedEmployees]);
  const applyRecordedAssignment = () => {
    const matches = (assignmentsQuery.data ?? []).filter(
      (a) =>
        selectedIds.includes(a.employee_id) &&
        a.effective_from <= workDate &&
        (!a.effective_to || a.effective_to >= workDate),
    );
    if (matches.length !== selectedIds.length) {
      notify("One or more selected employees have no recorded assignment for this date.", "warn");
      return;
    }
    const keys = new Set(matches.map((a) => batchKey(a.site, a.foreman)));
    if (keys.size !== 1) {
      notify(
        "Selected employees have different recorded assignments. Create separate attendance batches.",
        "warn",
      );
      return;
    }
    setSite(matches[0]!.site);
    setSelectedProjectId(matches[0]!.project_id);
    setForeman(matches[0]!.foreman);
    setSelectedForemanId(
      matches[0]!.foreman_user_id ??
        foremanOptions.find((option) => option.name === matches[0]!.foreman)?.userId ??
        null,
    );
    setDirty(true);
  };
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
      if (role === "foreman" && !projectAssignmentIds.has(employee.id)) return false;
      return (
        !assigned ||
        (editingKey !== null && batchKey(assigned.site, assigned.foreman) === editingKey)
      );
    });
  }, [activeEmployees, editingKey, employeeSearch, projectAssignmentIds, role, timesheets]);
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
  const markedCount = timesheets.length;
  const presentCount = timesheets.filter(
    (entry) => entry.status === "PRESENT" || entry.status === "HALF_DAY",
  ).length;
  const recordedHours = timesheets.reduce((total, entry) => total + Number(entry.total_hours), 0);
  const scheduledHours = (row: AttendanceDraft) =>
    hoursFor({
      ...row,
      breakHours: visibleColumns.breakHours ? row.breakHours : "0",
    });

  useEffect(() => {
    const pending = pendingDateEdit.current;
    if (!pending || timesheetsQuery.isLoading || timesheetsQuery.error) return;
    if (
      role === "foreman" &&
      (assignmentsQuery.isLoading || projectsQuery.isLoading || foremenQuery.isLoading)
    ) {
      return;
    }
    pendingDateEdit.current = null;

    const batch = pending.batchKey
      ? savedBatches.find((candidate) => candidate.key === pending.batchKey)
      : undefined;
    if (batch) {
      setSite(batch.site);
      setSelectedProjectId(
        batch.entries[0]?.project_id ??
          pending.projectId ??
          projects.find((project) => project.name === batch.site)?.id ??
          null,
      );
      setForeman(batch.foreman);
      setSelectedForemanId(
        batch.entries[0]?.foreman_user_id ??
          pending.foremanId ??
          (role === "foreman"
            ? currentUserId
            : (foremanOptions.find((option) => option.name === batch.foreman)?.userId ?? null)),
      );
      setEditingKey(batch.key);
      setSelectedIds(batch.entries.map((entry) => entry.employee_id));
      setAttendance(
        Object.fromEntries(
          batch.entries.map((entry) => [entry.employee_id, attendanceFromRecord(entry)]),
        ),
      );
    } else {
      setSite(pending.site);
      setSelectedProjectId(pending.projectId);
      setForeman(pending.foreman);
      setSelectedForemanId(
        pending.foremanId ??
          (role === "foreman"
            ? currentUserId
            : (foremanOptions.find((option) => option.name === pending.foreman)?.userId ?? null)),
      );
      setEditingKey(null);
      setSelectedIds([]);
      setAttendance({});
      if (role === "foreman" && pending.projectId) {
        const projectEntries = timesheets.filter(
          (entry) =>
            entry.project_id === pending.projectId && entry.foreman_user_id === currentUserId,
        );
        const assignedIds = (assignmentsQuery.data ?? [])
          .filter(
            (assignment) =>
              assignment.project_id === pending.projectId &&
              (role !== "foreman" || assignment.foreman_user_id === currentUserId) &&
              assignment.effective_from <= workDate &&
              (!assignment.effective_to || assignment.effective_to >= workDate),
          )
          .map((assignment) => assignment.employee_id);
        const entryIds = projectEntries.map((entry) => entry.employee_id);
        const employeeIds = [...new Set([...assignedIds, ...entryIds])].filter((id) => {
          const existing = timesheets.find((entry) => entry.employee_id === id);
          return (
            activeEmployees.some((employee) => employee.id === id) &&
            (!existing || entryIds.includes(id))
          );
        });
        setSelectedIds(employeeIds);
        setAttendance(
          Object.fromEntries(
            employeeIds.map((id) => {
              const existing = projectEntries.find((entry) => entry.employee_id === id);
              return [id, existing ? attendanceFromRecord(existing) : defaultAttendance()];
            }),
          ),
        );
        setEditingKey(
          projectEntries[0] ? batchKey(projectEntries[0].site, projectEntries[0].foreman) : null,
        );
      }
    }
    setDirty(false);
    setEmployeeSearch("");
    setEmployeePickerOpen(false);
    setCopyPickerOpen(false);
  }, [
    currentUserId,
    activeEmployees,
    assignmentsQuery.data,
    assignmentsQuery.isLoading,
    foremenQuery.isLoading,
    foremanOptions,
    projects,
    projectsQuery.isLoading,
    role,
    savedBatches,
    timesheets,
    timesheetsQuery.error,
    timesheetsQuery.isLoading,
    workDate,
  ]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const root = sectionRef.current;
    if (!root) return;
    const cards = root.querySelectorAll(".attendance-scroll-reveal");
    if (!("IntersectionObserver" in window)) {
      cards.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
    );
    cards.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [timesheetsQuery.isLoading]);

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
    setSelectedProjectId(null);
    setForeman("");
    setSelectedForemanId(null);
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
    setSelectedProjectId(
      batch.entries[0]?.project_id ??
        projects.find((project) => project.name === batch.site)?.id ??
        null,
    );
    setForeman(batch.foreman);
    setSelectedForemanId(
      batch.entries[0]?.foreman_user_id ??
        (role === "foreman"
          ? currentUserId
          : (foremanOptions.find((option) => option.name === batch.foreman)?.userId ?? null)),
    );
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

  const selectAllAvailable = () => {
    const available = filteredPickerEmployees.filter(
      (employee) => !selectedIds.includes(employee.id),
    );
    if (!available.length) return;
    setSelectedIds((current) => [...current, ...available.map((employee) => employee.id)]);
    setAttendance((current) => {
      const next = { ...current };
      available.forEach((employee) => {
        const existing = timesheets.find((entry) => entry.employee_id === employee.id);
        next[employee.id] = existing ? attendanceFromRecord(existing) : defaultAttendance();
      });
      return next;
    });
    setDirty(true);
  };

  const toggleSelectAllAvailable = () => {
    const allAvailableSelected =
      filteredPickerEmployees.length > 0 &&
      filteredPickerEmployees.every((employee) => selectedIds.includes(employee.id));
    if (!allAvailableSelected) {
      selectAllAvailable();
      return;
    }

    const existingBatchIds = new Set(
      timesheets
        .filter(
          (entry) => editingKey !== null && batchKey(entry.site, entry.foreman) === editingKey,
        )
        .map((entry) => entry.employee_id),
    );
    const availableIds = new Set(filteredPickerEmployees.map((employee) => employee.id));
    setSelectedIds((current) =>
      current.filter((id) => !availableIds.has(id) || existingBatchIds.has(id)),
    );
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
      } else if (patch.status && worked(patch.status)) {
        next.inTime ||= "08:00";
        next.outTime ||= "17:00";
        next.breakHours ||= "1";
        if (Number(next.manualHours) <= 0) {
          next.manualHours = String(hoursFor(next).toFixed(2));
        }
      }
      if (
        worked(next.status) &&
        (patch.inTime !== undefined ||
          patch.outTime !== undefined ||
          patch.breakHours !== undefined)
      ) {
        next.manualHours = String(hoursFor(next).toFixed(2));
      }
      return { ...current, [employeeId]: next };
    });
    setDirty(true);
  };

  const toggleColumn = (column: AttendanceColumn) => {
    const next = { ...visibleColumns, [column]: !visibleColumns[column] };
    const wasManual = !visibleColumns.inTime || !visibleColumns.outTime;
    const becomesManual = !next.inTime || !next.outTime;
    if (!wasManual && becomesManual) {
      setAttendance((rows) => {
        const updated = { ...rows };
        selectedEmployees.forEach((employee) => {
          const row = updated[employee.id] ?? defaultAttendance();
          updated[employee.id] = {
            ...row,
            manualHours: String(scheduledHours(row).toFixed(2)),
          };
        });
        return updated;
      });
    }
    setVisibleColumns(next);
    setDirty(true);
  };

  const applySchedule = () => {
    const breakHours = Number(bulkBreakHours);
    const [startHour, startMinute] = bulkInTime.split(":").map(Number);
    const [endHour, endMinute] = bulkOutTime.split(":").map(Number);
    const shiftHours = (endHour! * 60 + endMinute! - startHour! * 60 - startMinute!) / 60;
    if (
      !Number.isFinite(breakHours) ||
      breakHours < 0 ||
      !Number.isFinite(shiftHours) ||
      shiftHours <= 0 ||
      breakHours >= shiftHours
    ) {
      notify("Choose a valid shift and a break shorter than the shift.", "warn");
      return;
    }
    setAttendance((current) => {
      const next = { ...current };
      selectedEmployees.forEach((employee) => {
        const row = next[employee.id] ?? defaultAttendance();
        const scheduled: AttendanceDraft = {
          ...row,
          status: "PRESENT",
          inTime: bulkInTime,
          outTime: bulkOutTime,
          breakHours: bulkBreakHours,
        };
        next[employee.id] = {
          ...scheduled,
          manualHours: String(scheduledHours(scheduled).toFixed(2)),
        };
      });
      return next;
    });
    setDirty(true);
  };

  const loadCopiedBatch = (batch: AttendanceBatch) => {
    if (dirty && !confirmDiscard()) return;
    setSite(batch.site);
    setSelectedProjectId(batch.entries[0]?.project_id ?? null);
    setForeman(batch.foreman);
    setSelectedForemanId(
      batch.entries[0]?.foreman_user_id ??
        foremanOptions.find((option) => option.name === batch.foreman)?.userId ??
        null,
    );
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

  const openAssignedProject = (project: Project) => {
    if (dirty && !confirmDiscard()) return;
    if (assignmentsQuery.isLoading) {
      notify("Project worker assignments are still loading.", "warn");
      return;
    }
    if (assignmentsQuery.error) {
      notify(
        `Could not load project worker assignments: ${assignmentsQuery.error.message}`,
        "warn",
      );
      return;
    }
    const foremanAccount = foremenQuery.data?.find((user) => user.user_id === currentUserId);
    if (!foremanAccount) {
      notify(
        foremenQuery.error
          ? `Could not load your foreman account: ${foremenQuery.error.message}`
          : "Could not find your foreman account. Ask an administrator to check your account.",
        "warn",
      );
      return;
    }

    const foremanName =
      foremanAccount.full_name?.trim() || foremanAccount.email || "Unnamed foreman";
    const projectEntries = timesheets.filter(
      (entry) =>
        (entry.project_id === project.id || entry.site === project.name) &&
        (entry.foreman_user_id === currentUserId ||
          entry.foreman === foremanName ||
          (entry.foreman_user_id === null && entry.site === project.name)),
    );
    const entryIds = new Set(projectEntries.map((entry) => entry.employee_id));
    const assignedEmployeeIds = (assignmentsQuery.data ?? [])
      .filter(
        (assignment) =>
          assignment.project_id === project.id &&
          (role !== "foreman" || assignment.foreman_user_id === currentUserId) &&
          assignment.effective_from <= workDate &&
          (!assignment.effective_to || assignment.effective_to >= workDate),
      )
      .map((assignment) => assignment.employee_id);
    const candidateIds = new Set([...assignedEmployeeIds, ...entryIds]);
    const employeeIds = [...candidateIds].filter((id) => {
      if (!employeeById.has(id)) return false;
      const existing = timesheets.find((entry) => entry.employee_id === id);
      return !existing || entryIds.has(id);
    });
    const matchingBatch = savedBatches.find((batch) =>
      batch.entries.some((entry) => entryIds.has(entry.employee_id)),
    );

    setSite(project.name);
    setSelectedProjectId(project.id);
    setForeman(foremanName);
    setSelectedForemanId(currentUserId);
    setEditingKey(matchingBatch?.key ?? null);
    setSelectedIds(employeeIds);
    setAttendance(
      Object.fromEntries(
        employeeIds.map((id) => {
          const existing = timesheets.find(
            (entry) =>
              entry.employee_id === id && (entry.project_id === project.id || entryIds.has(id)),
          );
          return [id, existing ? attendanceFromRecord(existing) : defaultAttendance()];
        }),
      ),
    );
    setDirty(false);
    setEmployeeSearch("");
    setEmployeePickerOpen(false);
    setCopyPickerOpen(false);
  };

  const selectProject = (project: Project) => {
    if (role === "foreman") {
      openAssignedProject(project);
      return;
    }
    if (dirty && !confirmDiscard()) return;
    const assignedForeman = foremanOptions.find(
      (option) => option.userId === project.foreman_user_id,
    );
    setSite(project.name);
    setSelectedProjectId(project.id);
    setForeman(assignedForeman?.name ?? "");
    setSelectedForemanId(assignedForeman?.userId ?? null);
    setSelectedIds([]);
    setAttendance({});
    setEditingKey(null);
    setDirty(false);
    setEmployeeSearch("");
    setEmployeePickerOpen(false);
    setCopyPickerOpen(false);
  };

  const saveBatch = async () => {
    const cleanSite = site.trim();
    const cleanForeman = foreman.trim();
    if (!cleanSite || !cleanForeman) {
      notify("Enter both a site and a foreman before saving the attendance batch.", "warn");
      return;
    }
    const projectId =
      selectedProjectId ?? projects.find((project) => project.name === cleanSite)?.id ?? null;
    if (!projectId) {
      notify("Choose an existing project before saving attendance.", "warn");
      return;
    }
    if (role === "foreman" && selectedForemanId !== currentUserId) {
      notify("Foremen can only record attendance under their own account.", "warn");
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

    const manualHoursEntry = !visibleColumns.inTime || !visibleColumns.outTime;
    const invalid = selectedEmployees.filter((employee) => {
      const row = attendance[employee.id] ?? defaultAttendance();
      if (!worked(row.status)) return false;
      const breakHours = visibleColumns.breakHours ? Number(row.breakHours) : 0;
      const overtime = visibleColumns.overtime ? Number(row.overtime) : 0;
      if (manualHoursEntry) {
        const manualHours = Number(row.manualHours);
        const duration = (manualHours + breakHours) * 60;
        const [startHour, startMinute] = row.inTime.split(":").map(Number);
        const [endHour, endMinute] = row.outTime.split(":").map(Number);
        const startMinutes = startHour! * 60 + startMinute!;
        const endMinutes = endHour! * 60 + endMinute!;
        return (
          !Number.isFinite(manualHours) ||
          manualHours <= 0 ||
          !Number.isFinite(duration) ||
          duration >= 24 * 60 ||
          !Number.isFinite(breakHours) ||
          breakHours < 0 ||
          !Number.isFinite(overtime) ||
          overtime < 0 ||
          overtime > manualHours ||
          (visibleColumns.inTime && startMinutes + duration >= 24 * 60) ||
          (!visibleColumns.inTime && visibleColumns.outTime && endMinutes - duration < 0) ||
          (!visibleColumns.inTime && !visibleColumns.outTime && 8 * 60 + duration >= 24 * 60)
        );
      }
      const start = row.inTime.split(":").map(Number);
      const end = row.outTime.split(":").map(Number);
      const startMinutes = start[0]! * 60 + start[1]!;
      const endMinutes = end[0]! * 60 + end[1]!;
      const visibleBreakHours = visibleColumns.breakHours ? Number(row.breakHours) : 0;
      const visibleOvertime = visibleColumns.overtime ? Number(row.overtime) : 0;
      const shiftHours = (endMinutes - startMinutes) / 60;
      return (
        !row.inTime ||
        !row.outTime ||
        endMinutes <= startMinutes ||
        !Number.isFinite(visibleBreakHours) ||
        visibleBreakHours < 0 ||
        visibleBreakHours > shiftHours ||
        !Number.isFinite(visibleOvertime) ||
        visibleOvertime < 0 ||
        visibleOvertime > shiftHours - visibleBreakHours
      );
    });
    if (invalid.length) {
      notify(
        `Check the total-hours or time, break, and overtime values for ${invalid.map((employee) => employee.name).join(", ")}.`,
        "warn",
      );
      return;
    }

    const payload = selectedEmployees.map((employee) => {
      const row = attendance[employee.id] ?? defaultAttendance();
      const doesWork = worked(row.status);
      const breakHours = visibleColumns.breakHours ? Number(row.breakHours) || 0 : 0;
      const overtime = visibleColumns.overtime ? Number(row.overtime) || 0 : 0;
      let inTime = row.inTime;
      let outTime = row.outTime;
      if (doesWork && manualHoursEntry) {
        const duration = Math.round((Number(row.manualHours) + breakHours) * 60);
        if (visibleColumns.inTime) {
          const [hours, minutes] = row.inTime.split(":").map(Number);
          const endMinutes = hours! * 60 + minutes! + duration;
          outTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
        } else if (visibleColumns.outTime) {
          const [hours, minutes] = row.outTime.split(":").map(Number);
          const startMinutes = hours! * 60 + minutes! - duration;
          inTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
        } else {
          inTime = "08:00";
          const endMinutes = 8 * 60 + duration;
          outTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
        }
      }
      return {
        employee_id: employee.id,
        site: cleanSite,
        foreman: cleanForeman,
        project_id: projectId,
        foreman_user_id: selectedForemanId,
        work_date: workDate,
        status: row.status,
        in_time: doesWork ? inTime : null,
        out_time: doesWork ? outTime : null,
        break_hours: doesWork ? breakHours : 0,
        overtime_hours: doesWork ? overtime : 0,
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
    <section ref={sectionRef} className="space-y-2.5">
      <section className={`${card} space-y-4 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-extrabold text-navy">
              {role === "foreman" ? "Your assigned projects" : "Active projects"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {role === "foreman"
                ? "Choose an assigned project to review its team and record attendance."
                : "Choose a project to start or update its daily attendance."}
            </p>
          </div>
          <label className="attendance-batch-field">
            Project status
            <select
              aria-label="Show projects by status"
              className={`${select} max-w-44`}
              value={projectStatusFilter}
              onChange={(event) =>
                setProjectStatusFilter(event.target.value as typeof projectStatusFilter)
              }
            >
              <option value="active">Active projects</option>
              <option value="completed">Completed projects</option>
              <option value="all">All projects</option>
            </select>
          </label>
        </div>
        {projectsQuery.error && (
          <p role="alert" className="text-sm text-danger">
            Could not load projects: {projectAccessError(projectsQuery.error, "load")}
          </p>
        )}
        {assignmentsQuery.error && (
          <p role="alert" className="text-sm text-danger">
            Could not load project worker assignments: {assignmentsQuery.error.message}
          </p>
        )}
        {projectsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        ) : (role === "foreman" ? visibleForemanProjects : visibleProjects).length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(role === "foreman" ? visibleForemanProjects : visibleProjects).map((project) => {
              const roster = (assignmentsQuery.data ?? []).filter(
                (assignment) =>
                  assignment.project_id === project.id &&
                  (role !== "foreman" || assignment.foreman_user_id === currentUserId) &&
                  assignment.effective_from <= workDate &&
                  (!assignment.effective_to || assignment.effective_to >= workDate),
              );
              const rosterIds = new Set(roster.map((assignment) => assignment.employee_id));
              const projectEntries = timesheets.filter(
                (entry) =>
                  (entry.project_id === project.id || entry.site === project.name) &&
                  (role !== "foreman" || rosterIds.has(entry.employee_id)),
              );
              const selected = selectedProjectId === project.id;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    selectProject(project);
                    setSheetOpen(true);
                  }}
                  aria-pressed={selected}
                  className={`project-attendance-card rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                    selected
                      ? "border-navy bg-navy-soft shadow-sm"
                      : "border-border bg-card hover:border-navy/40"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-display text-base font-bold text-navy">
                      {project.name}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        project.active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {project.active ? "Active" : "Completed"}
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <MapPin size={13} className="shrink-0" />
                    {project.location || "Site location not set"}
                  </span>
                  <span className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                      <Users size={14} />
                      {roster.length} assigned
                    </span>
                    <span className="font-semibold text-slate-600">
                      {projectEntries.length} marked today
                    </span>
                  </span>
                  <span className="mt-3 block text-xs font-bold text-navy">
                    {selected ? "Selected · attendance below" : "Open daily attendance →"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
            {role === "foreman" && !assignedProjects.length
              ? "No projects are currently assigned to your foreman account. Ask an administrator to assign a project."
              : "No projects match this status filter."}
          </p>
        )}
      </section>
      {sheetOpen && (
        <section
          role="dialog"
          aria-modal="true"
          className="attendance-sheet fixed inset-0 z-[60] flex items-stretch justify-center bg-foreground/40 backdrop-blur-sm sm:items-center sm:p-4"
          aria-label="Daily timesheet editor"
        >
          <div className="attendance-dialog flex h-full w-full max-w-6xl flex-col gap-3 overflow-y-auto bg-background p-3 shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl sm:p-5">
            <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/95 px-1 py-3 backdrop-blur">
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-bold text-navy">
                  {site || "Select a project"}
                  {foreman ? ` · ${foreman}` : ""}
                </h2>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Daily · {workDate}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-card px-2 text-[11px] font-semibold text-slate-600">
                  <CalendarDays size={14} className="shrink-0 text-slate-400" />
                  <input
                    type="date"
                    value={workDate}
                    aria-label="Attendance date"
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      if (!nextDate || nextDate === workDate) return;
                      if (dirty && !window.confirm("Discard unsaved attendance batch changes?"))
                        return;
                      pendingDateEdit.current = {
                        batchKey: editingKey,
                        site,
                        foreman,
                        projectId: selectedProjectId,
                        foremanId: selectedForemanId,
                      };
                      setDirty(false);
                      setWorkDate(nextDate);
                      setCopyPickerOpen(false);
                    }}
                    className="w-[8.5rem] bg-transparent text-xs font-semibold text-navy focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={saving || !selectedCount || Boolean(duplicateAssignments.length)}
                  onClick={() => void saveBatch()}
                  className={`${btnGold} min-h-9 rounded-md px-3 text-xs`}
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (dirty && !window.confirm("Discard unsaved attendance changes?")) return;
                    setDirty(false);
                    setSheetOpen(false);
                  }}
                  className={`${btnOutline} min-h-9 rounded-md px-3 text-xs`}
                >
                  <X size={16} /> Close
                </button>
              </div>
            </header>
            <div className={`${card} attendance-batch-toolbar attendance-scroll-reveal`}>
              <label className="attendance-batch-field">
                Attendance date
                <input
                  type="date"
                  value={workDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    if (!nextDate || nextDate === workDate) return;
                    if (dirty && !window.confirm("Discard unsaved attendance batch changes?"))
                      return;
                    pendingDateEdit.current = {
                      batchKey: editingKey,
                      site,
                      foreman,
                      projectId: selectedProjectId,
                      foremanId: selectedForemanId,
                    };
                    setDirty(false);
                    setWorkDate(nextDate);
                    setCopyPickerOpen(false);
                  }}
                  className={`${input} rounded-md px-2 py-1 text-xs`}
                />
              </label>
              {role !== "foreman" && (
                <>
                  <button
                    type="button"
                    className={`${btnOutline} rounded-md px-2.5 py-1 text-xs`}
                    disabled={!selectedIds.length || assignmentsQuery.isLoading}
                    onClick={applyRecordedAssignment}
                  >
                    Use recorded assignment
                  </button>
                  <label className="attendance-batch-field">
                    Site / project
                    <select
                      required
                      value={selectedProjectId ?? ""}
                      onChange={(event) => {
                        if (dirty && !confirmDiscard()) return;
                        const project = projects.find((item) => item.id === event.target.value);
                        setSelectedProjectId(project?.id ?? null);
                        setSite(project?.name ?? "");
                        const assignedForeman = foremanOptions.find(
                          (option) => option.userId === project?.foreman_user_id,
                        );
                        setForeman(assignedForeman?.name ?? "");
                        setSelectedForemanId(assignedForeman?.userId ?? null);
                        setSelectedIds([]);
                        setAttendance({});
                        setEditingKey(null);
                        setDirty(false);
                      }}
                      className={`${select} rounded-md px-2 py-1 text-xs`}
                    >
                      <option value="">Choose an existing project</option>
                      {visibleProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                          {project.active ? "" : " (completed)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="attendance-batch-field">
                    Foreman
                    <select
                      required
                      value={
                        selectedForemanId ??
                        foremanOptions.find((option) => !option.userId && option.name === foreman)
                          ?.value ??
                        ""
                      }
                      onChange={(event) => {
                        const option = foremanOptions.find(
                          (item) => item.value === event.target.value,
                        );
                        setForeman(option?.name ?? "");
                        setSelectedForemanId(option?.userId ?? null);
                        setDirty(true);
                      }}
                      className={`${select} rounded-md px-2 py-1 text-xs`}
                    >
                      <option value="">Choose an existing foreman</option>
                      {foremanOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="attendance-batch-actions">
                    <button
                      type="button"
                      onClick={() => setMonthlyAttendanceOpen(true)}
                      className={`${btnOutline} rounded-md px-2.5 py-1 text-xs`}
                    >
                      <CalendarDays size={13} /> Monthly employee entry
                    </button>
                    <button
                      type="button"
                      onClick={copyPreviousDay}
                      className={`${btnOutline} rounded-md px-2.5 py-1 text-xs`}
                    >
                      <Copy size={13} /> Copy previous day
                    </button>
                    <button
                      type="button"
                      onClick={startNewBatch}
                      className={`${btnGold} rounded-md px-2.5 py-1 text-xs`}
                    >
                      <Plus size={14} /> New batch
                    </button>
                  </div>
                </>
              )}
            </div>

            {timesheetsQuery.error && (
              <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                <AlertTriangle size={15} /> Could not load attendance:{" "}
                {timesheetsQuery.error.message}
              </p>
            )}
            {role !== "foreman" && projectsQuery.error && (
              <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                Could not load projects: {projectsQuery.error.message}
              </p>
            )}
            {role !== "foreman" && foremenQuery.error && (
              <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                Could not load foremen: {foremenQuery.error.message}
              </p>
            )}
            {role !== "foreman" && assignmentsQuery.error && (
              <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                Could not load employee assignments:{" "}
                {projectAccessError(assignmentsQuery.error, "load")}
              </p>
            )}

            {timesheetsQuery.isLoading ? (
              <div className={`${card} p-8 text-center text-sm text-muted-foreground`}>
                Loading attendance for {workDate}…
              </div>
            ) : (
              <>
                <section
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                  aria-label="Daily attendance summary"
                >
                  {[
                    { label: "Marked", value: markedCount, icon: Users },
                    { label: "Present", value: presentCount, icon: Check },
                    { label: "Total hours", value: recordedHours.toFixed(2), icon: Clock3 },
                    { label: "Selected employees", value: selectedCount, icon: Users },
                  ].map(({ label, value, icon }) => (
                    <AttendanceSummaryCard key={label} label={label} value={value} icon={icon} />
                  ))}
                </section>
                <section
                  className={`${card} flex flex-wrap items-center justify-between gap-3 p-3`}
                  aria-label="Project employee assignments"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-soft text-navy">
                      <Users size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Assigned employees
                      </p>
                      <p className="font-display text-lg font-extrabold tabular-nums text-navy">
                        {assignmentsQuery.isLoading
                          ? "Loading…"
                          : `${projectAssignmentIds.size} employee${projectAssignmentIds.size === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </div>
                  {!assignmentsQuery.isLoading &&
                    !assignmentsQuery.error &&
                    projectAssignmentIds.size === 0 && (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/10 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-navy">
                            No employees assigned for {workDate}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            Ask a manager or administrator to assign workers to this project. You
                            can still review any attendance already saved for this date.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={onOpenWorkforce}
                          className={`${btnOutline} shrink-0 rounded-md px-3 py-2 text-xs`}
                        >
                          Open Workforce &amp; Leave
                        </button>
                      </div>
                    )}
                </section>
                <div className="space-y-2 attendance-scroll-reveal">
                  {editingKey && (
                    <p className="px-1 text-xs font-semibold text-navy">
                      Editing saved attendance batch
                    </p>
                  )}

                  {copyPickerOpen && (
                    <div className="rounded-xl border border-gold/40 bg-gold/10 p-3">
                      <p className="mb-2 text-xs font-bold text-navy">
                        Choose a batch from {previousDate} to copy. It will be staged for {workDate}
                        ; nothing is saved until you press Save batch.
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

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative min-w-0 flex-1 sm:max-w-xs">
                      <Search
                        size={14}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={attendanceSearch}
                        onChange={(event) => setAttendanceSearch(event.target.value)}
                        placeholder="Search selected employees"
                        aria-label="Search selected employees"
                        className={`${input} h-8 pl-8 text-xs`}
                      />
                    </label>
                    <div className="relative w-full max-w-xs">
                      <button
                        type="button"
                        onClick={() => setEmployeePickerOpen((open) => !open)}
                        aria-expanded={employeePickerOpen}
                        className={`${input} flex h-8 items-center justify-between rounded-md px-2 py-1 text-left text-xs`}
                      >
                        <span>
                          {selectedCount
                            ? `${selectedCount} employee${selectedCount === 1 ? "" : "s"} selected`
                            : "Select employees…"}
                        </span>
                        <ChevronDown size={16} />
                      </button>
                      {employeePickerOpen && (
                        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-card p-2 shadow-lg">
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
                                  [
                                    employee.name,
                                    employee.trade,
                                    employee.id_number,
                                    String(employee.id),
                                  ]
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
                                  (!editingKey ||
                                    batchKey(assigned.site, assigned.foreman) !== editingKey);
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
                                No available employees match. Workers already assigned today are
                                locked to their existing site batch.
                              </p>
                            )}
                          </div>
                          <div className="mt-2 flex justify-between gap-2 border-t border-border pt-2">
                            <button
                              type="button"
                              onClick={toggleSelectAllAvailable}
                              disabled={!filteredPickerEmployees.length}
                              className={btnOutline}
                            >
                              {filteredPickerEmployees.length > 0 &&
                              filteredPickerEmployees.every((employee) =>
                                selectedIds.includes(employee.id),
                              )
                                ? "Clear available"
                                : "Select all available"}
                            </button>
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
                    <button
                      type="button"
                      onClick={toggleSelectAllAvailable}
                      disabled={!filteredPickerEmployees.length}
                      className={`${btnOutline} h-8 px-2.5 py-1 text-xs`}
                    >
                      {filteredPickerEmployees.length > 0 &&
                      filteredPickerEmployees.every((employee) => selectedIds.includes(employee.id))
                        ? "Clear available"
                        : "Select all"}
                    </button>
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

                  <div className="attendance-savebar attendance-scroll-reveal flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-slate-50 p-2.5">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-[10px] font-bold uppercase text-slate-500">
                        In time
                        <TimeControl
                          value={bulkInTime}
                          onChange={setBulkInTime}
                          label="Bulk in time"
                          compact
                        />
                      </label>
                      <label className="text-[10px] font-bold uppercase text-slate-500">
                        Out time
                        <TimeControl
                          value={bulkOutTime}
                          onChange={setBulkOutTime}
                          label="Bulk out time"
                          compact
                        />
                      </label>
                      <label className="text-[10px] font-bold uppercase text-slate-500">
                        Break (hrs)
                        <input
                          type="number"
                          min="0"
                          max="23.75"
                          step="0.25"
                          value={bulkBreakHours}
                          onChange={(event) => setBulkBreakHours(event.target.value)}
                          aria-label="Bulk break duration in hours"
                          className={`${input} h-8 w-24 rounded px-2 py-1 text-xs`}
                        />
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {SHIFT_PRESETS.map(({ start, end, label }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => {
                              setBulkInTime(start);
                              setBulkOutTime(end);
                            }}
                            className={`${btnOutline} h-8 px-2 py-1 text-[11px]`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={applySchedule}
                        disabled={!selectedCount}
                        className={`${btnOutline} h-9 px-3 py-1 text-xs`}
                      >
                        <Check size={13} /> Apply to selected
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {dirty && (
                        <span className="text-[11px] font-semibold text-warn" role="status">
                          Unsaved changes
                        </span>
                      )}
                      {dirty && (
                        <button
                          type="button"
                          onClick={startNewBatch}
                          className={`${btnOutline} h-8 rounded-md px-2.5 py-1 text-xs`}
                        >
                          <X size={13} /> Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={saving || !selectedCount || Boolean(duplicateAssignments.length)}
                        onClick={() => void saveBatch()}
                        className={`${btnGold} h-8 rounded-md px-3 py-1 text-xs`}
                      >
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>

                  <div className="attendance-scroll-reveal space-y-2 rounded-md border border-border bg-card p-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Attendance columns
                      </span>
                      {ATTENDANCE_COLUMNS.map(({ value, label }) => (
                        <label
                          key={value}
                          className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-slate-600"
                        >
                          <input
                            type="checkbox"
                            checked={visibleColumns[value]}
                            onChange={() => toggleColumn(value)}
                            className="h-4 w-4 accent-[var(--navy)]"
                          />
                          {label}
                        </label>
                      ))}
                      {(!visibleColumns.inTime || !visibleColumns.outTime) && (
                        <span className="text-[11px] font-semibold text-money">
                          Enter total hours directly; hidden shift times are calculated on save.
                        </span>
                      )}
                    </div>
                    {!isMobile && (
                      <div className="attendance-table-scroll overflow-x-auto">
                        <table
                          className="w-full table-fixed border-collapse text-xs"
                          style={{
                            minWidth: `${880 + Number(visibleColumns.inTime) * 176 + Number(visibleColumns.outTime) * 176 + Number(visibleColumns.breakHours) * 72 + Number(visibleColumns.overtime) * 80}px`,
                          }}
                        >
                          <thead className="bg-slate-100">
                            <tr className="h-8 border-b border-border text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              <th className="w-9 px-2 text-center" aria-label="Selected" />
                              <th className="w-32 px-2 text-left">Status</th>
                              <th className="sticky left-[164px] z-20 w-36 bg-slate-100 px-2 text-left">
                                Employee
                              </th>
                              <th className="w-36 px-2 text-left">Role / Phone</th>
                              {visibleColumns.inTime && <th className="w-52 px-2 text-left">In</th>}
                              {visibleColumns.outTime && (
                                <th className="w-52 px-2 text-left">Out</th>
                              )}
                              {visibleColumns.breakHours && (
                                <th className="w-20 px-2 text-left">Break (hrs)</th>
                              )}
                              {visibleColumns.overtime && (
                                <th className="w-24 px-2 text-left">Overtime (hrs)</th>
                              )}
                              <th className="w-28 px-2 text-left">Total hrs</th>
                              <th className="w-48 px-2 text-left">Attendance note</th>
                              <th className="w-12 px-2 text-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {selectedEmployees.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={
                                    7 +
                                    Number(visibleColumns.inTime) +
                                    Number(visibleColumns.outTime) +
                                    Number(visibleColumns.breakHours) +
                                    Number(visibleColumns.overtime)
                                  }
                                  className="h-14 px-3 text-center text-xs text-muted-foreground"
                                >
                                  Select employees above to add them to this attendance batch.
                                </td>
                              </tr>
                            ) : filteredAttendanceEmployees.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={11}
                                  className="h-14 px-3 text-center text-xs text-muted-foreground"
                                >
                                  No selected employees match your search.
                                </td>
                              </tr>
                            ) : (
                              filteredAttendanceEmployees.map((employee) => {
                                const row = attendance[employee.id] ?? defaultAttendance();
                                const workedToday = worked(row.status);
                                const assignedExisting =
                                  editingKey !== null &&
                                  timesheets.some(
                                    (entry) =>
                                      entry.employee_id === employee.id &&
                                      batchKey(entry.site, entry.foreman) === editingKey,
                                  );
                                const statusStyle =
                                  row.status === "PRESENT"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : row.status === "ABSENT"
                                      ? "border-rose-200 bg-rose-50 text-rose-800"
                                      : row.status === "HALF_DAY"
                                        ? "border-amber-200 bg-amber-50 text-amber-800"
                                        : row.status === "LEAVE"
                                          ? "border-sky-200 bg-sky-50 text-sky-800"
                                          : "border-slate-200 bg-white text-slate-700";
                                return (
                                  <tr key={employee.id} className="h-11 hover:bg-slate-50/70">
                                    <td className="px-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked
                                        disabled={assignedExisting}
                                        onChange={() => toggleEmployee(employee)}
                                        aria-label={`Select ${employee.name}`}
                                        className="h-3.5 w-3.5 accent-[var(--navy)] disabled:opacity-50"
                                      />
                                    </td>
                                    <td className="px-2">
                                      <select
                                        value={row.status}
                                        onChange={(event) =>
                                          updateAttendance(employee.id, {
                                            status: event.target.value as AttendanceStatus,
                                          })
                                        }
                                        aria-label={`${employee.name} status`}
                                        className={`${select} h-7 rounded border px-1.5 py-0 text-[11px] ${statusStyle}`}
                                      >
                                        {ATTENDANCE_STATUSES.map((status) => (
                                          <option key={status.value} value={status.value}>
                                            {status.label}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td
                                      className="sticky left-[164px] z-10 truncate bg-card px-2 font-semibold text-navy"
                                      title={employee.name}
                                    >
                                      {employee.name}
                                    </td>
                                    <td
                                      className="truncate px-2 text-[11px] text-slate-500"
                                      title={`${employee.trade} / ${employee.id_number || employee.id}`}
                                    >
                                      {employee.trade} / {employee.id_number || `ID ${employee.id}`}
                                    </td>
                                    {visibleColumns.inTime && (
                                      <td className="px-2">
                                        <TimeControl
                                          value={row.inTime}
                                          disabled={!workedToday}
                                          onChange={(value) =>
                                            updateAttendance(employee.id, { inTime: value })
                                          }
                                          label={`${employee.name} clock-in time`}
                                          compact
                                        />
                                      </td>
                                    )}
                                    {visibleColumns.outTime && (
                                      <td className="px-2">
                                        <TimeControl
                                          value={row.outTime}
                                          disabled={!workedToday}
                                          onChange={(value) =>
                                            updateAttendance(employee.id, { outTime: value })
                                          }
                                          label={`${employee.name} clock-out time`}
                                          compact
                                        />
                                      </td>
                                    )}
                                    {visibleColumns.breakHours && (
                                      <td className="px-2">
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.25"
                                          value={row.breakHours}
                                          disabled={!workedToday}
                                          onChange={(event) =>
                                            updateAttendance(employee.id, {
                                              breakHours: event.target.value,
                                            })
                                          }
                                          aria-label={`${employee.name} break hours`}
                                          className={`${input} h-7 rounded px-1.5 py-0 text-xs disabled:opacity-50`}
                                        />
                                      </td>
                                    )}
                                    {visibleColumns.overtime && (
                                      <td className="px-2">
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.25"
                                          value={row.overtime}
                                          disabled={!workedToday}
                                          onChange={(event) =>
                                            updateAttendance(employee.id, {
                                              overtime: event.target.value,
                                            })
                                          }
                                          aria-label={`${employee.name} overtime hours`}
                                          className={`${input} h-7 rounded px-1.5 py-0 text-xs disabled:opacity-50`}
                                        />
                                      </td>
                                    )}
                                    <td className="px-2">
                                      {!visibleColumns.inTime || !visibleColumns.outTime ? (
                                        <input
                                          type="number"
                                          min="0.25"
                                          max="24"
                                          step="0.25"
                                          value={row.manualHours}
                                          disabled={!workedToday}
                                          onChange={(event) =>
                                            updateAttendance(employee.id, {
                                              manualHours: event.target.value,
                                            })
                                          }
                                          aria-label={`${employee.name} total hours`}
                                          className={`${input} h-9 rounded px-2 py-1 text-sm font-bold tabular-nums disabled:opacity-50`}
                                        />
                                      ) : (
                                        <span className="text-xs font-semibold tabular-nums text-navy">
                                          {scheduledHours(row).toFixed(2)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2">
                                      <input
                                        value={row.notes}
                                        onChange={(event) =>
                                          updateAttendance(employee.id, {
                                            notes: event.target.value,
                                          })
                                        }
                                        aria-label={`${employee.name} attendance note`}
                                        placeholder="Add a note for this shift"
                                        className={`${input} attendance-notes-input h-9 w-48 rounded px-2 py-1 text-xs`}
                                      />
                                    </td>
                                    <td className="px-2 text-center">
                                      {!assignedExisting && (
                                        <button
                                          type="button"
                                          onClick={() => toggleEmployee(employee)}
                                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:border-danger/40 hover:bg-danger/5 hover:text-danger"
                                          aria-label={`Remove ${employee.name} from this unsaved batch`}
                                          title="Remove from batch"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {isMobile && (
                      <div className="space-y-2">
                        {selectedEmployees.length === 0 ? (
                          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                            Select employees above to add them to this attendance batch.
                          </p>
                        ) : filteredAttendanceEmployees.length === 0 ? (
                          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                            No selected employees match your search.
                          </p>
                        ) : (
                          filteredAttendanceEmployees.map((employee) => {
                            const row = attendance[employee.id] ?? defaultAttendance();
                            const assignedExisting =
                              editingKey !== null &&
                              timesheets.some(
                                (entry) =>
                                  entry.employee_id === employee.id &&
                                  batchKey(entry.site, entry.foreman) === editingKey,
                              );
                            return (
                              <MobileAttendanceCard
                                key={employee.id}
                                employee={employee}
                                row={row}
                                visibleColumns={visibleColumns}
                                assignedExisting={assignedExisting}
                                onSelect={() => toggleEmployee(employee)}
                                onUpdate={(patch) => updateAttendance(employee.id, patch)}
                                totalHours={scheduledHours(row)}
                              />
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <section className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-bold text-navy">Saved batches</h3>
                      <span className="text-[11px] text-muted-foreground">
                        {timesheets.length} workers · {savedBatches.length} batches · {workDate}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={startNewBatch}
                      className={`${btnGold} h-8 rounded-md px-2.5 py-1 text-xs`}
                    >
                      <Plus size={13} /> Create another batch
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border bg-card">
                    <table className="w-full min-w-[760px] border-collapse text-xs">
                      <thead className="bg-slate-100">
                        <tr className="h-8 border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          <th className="w-10 px-2">#</th>
                          <th className="w-28 px-2">Date</th>
                          <th className="px-2">Site / project</th>
                          <th className="px-2">Foreman</th>
                          <th className="w-36 px-2">Workers</th>
                          <th className="w-40 px-2">Created at</th>
                          <th className="w-28 px-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {savedBatches.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="h-11 px-3 text-center text-xs text-muted-foreground"
                            >
                              No attendance batches saved for this date. Create a batch above or
                              copy yesterday’s attendance.
                            </td>
                          </tr>
                        ) : (
                          savedBatches.map((batch, index) => {
                            const present = batch.entries.filter((entry) =>
                              worked(entry.status),
                            ).length;
                            const firstEntry = batch.entries[0];
                            return (
                              <tr key={batch.key} className="h-10 hover:bg-slate-50/70">
                                <td className="px-2 tabular-nums text-slate-500">{index + 1}</td>
                                <td className="px-2 tabular-nums">
                                  {new Date(`${workDate}T00:00:00`).toLocaleDateString("en-GB")}
                                </td>
                                <td className="max-w-52 truncate px-2 font-semibold text-navy">
                                  {batch.site}
                                </td>
                                <td className="max-w-48 truncate px-2">{batch.foreman}</td>
                                <td className="px-2 tabular-nums">
                                  {batch.entries.length} · {present} present
                                </td>
                                <td className="px-2 text-slate-500">
                                  {firstEntry
                                    ? new Date(firstEntry.created_at).toLocaleString("en-GB", {
                                        dateStyle: "short",
                                        timeStyle: "short",
                                      })
                                    : "—"}
                                </td>
                                <td className="px-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => editBatch(batch)}
                                    className={`${btnOutline} h-7 rounded px-2 py-0.5 text-[11px]`}
                                  >
                                    <Pencil size={12} /> Edit batch
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      )}
      {monthlyAttendanceOpen && (
        <MonthlyAttendanceDialog
          employees={employees}
          saving={saving}
          onSave={onSave}
          onOpenChange={setMonthlyAttendanceOpen}
          notify={notify}
        />
      )}
    </section>
  );
}
