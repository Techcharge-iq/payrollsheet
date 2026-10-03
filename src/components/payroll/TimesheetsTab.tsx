import { useMemo, useState } from "react";
import { Check, Clock3, HardHat, Plus, Search, Users, X } from "lucide-react";
import type { Employee } from "@/lib/payroll";
import type { TimesheetRecord } from "@/lib/payroll-data";
import { btnGold, card, input, inputSm } from "./ui";

interface Props {
  employees: Employee[];
  timesheets: TimesheetRecord[];
  loading: boolean;
  error: string;
  saving: boolean;
  onSave: (rows: Omit<TimesheetRecord, "id" | "created_at" | "total_hours">[]) => Promise<void>;
  notify: (message: string, tone?: "ok" | "warn") => void;
}

interface AttendanceInput {
  inTime: string;
  outTime: string;
  breakHours: string;
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function hoursFor(entry: AttendanceInput) {
  if (!entry.inTime || !entry.outTime || entry.outTime <= entry.inTime) return 0;
  const [inHour, inMinute] = entry.inTime.split(":").map(Number);
  const [outHour, outMinute] = entry.outTime.split(":").map(Number);
  const elapsed = (outHour! * 60 + outMinute! - inHour! * 60 - inMinute!) / 60;
  return Math.max(0, elapsed - (Number(entry.breakHours) || 0));
}

function validateEntry(entry: AttendanceInput, employeeName: string) {
  if (!entry.inTime || !entry.outTime) {
    return `${employeeName}: enter both in and out times.`;
  }
  if (entry.outTime <= entry.inTime) {
    return `${employeeName}: out time must be later than in time. Overnight shifts are not supported.`;
  }
  const breakHours = Number(entry.breakHours);
  if (!Number.isFinite(breakHours) || breakHours < 0) {
    return `${employeeName}: break hours must be zero or greater.`;
  }
  if (breakHours > hoursFor({ ...entry, breakHours: "0" })) {
    return `${employeeName}: break cannot exceed the shift duration.`;
  }
  return "";
}

const emptyEntry: AttendanceInput = { inTime: "", outTime: "", breakHours: "0" };

export function TimesheetsTab({
  employees,
  timesheets,
  loading,
  error,
  saving,
  onSave,
  notify,
}: Props) {
  const [mode, setMode] = useState<"individual" | "bulk">("individual");
  const [employeeId, setEmployeeId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [crewEmployeeIds, setCrewEmployeeIds] = useState<number[]>([]);
  const [crewSearch, setCrewSearch] = useState("");
  const [site, setSite] = useState("");
  const [foreman, setForeman] = useState("");
  const [workDate, setWorkDate] = useState(today);
  const [individual, setIndividual] = useState<AttendanceInput>(emptyEntry);
  const [bulkEntries, setBulkEntries] = useState<Record<number, AttendanceInput>>({});

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((employee) => employee.status === "Active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );
  const crewEmployees = useMemo(
    () => activeEmployees.filter((employee) => crewEmployeeIds.includes(employee.id)),
    [activeEmployees, crewEmployeeIds],
  );
  const sites = useMemo(
    () => [...new Set(timesheets.map((entry) => entry.site).filter(Boolean))].sort(),
    [timesheets],
  );
  const foremen = useMemo(
    () =>
      [
        ...new Set(
          [
            ...employees
              .filter((employee) => employee.trade === "FORMAN")
              .map((employee) => employee.name),
            ...timesheets.map((entry) => entry.foreman),
          ].filter(Boolean),
        ),
      ].sort(),
    [employees, timesheets],
  );
  const selectedEmployee = employees.find((employee) => String(employee.id) === employeeId);

  const commonError = () => {
    if (!site.trim()) return "Site name is required.";
    if (!foreman.trim()) return "Foreman name is required.";
    if (!workDate) return "Work date is required.";
    return "";
  };

  const saveIndividual = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const issue = commonError() || (!selectedEmployee ? "Select an employee." : "");
    const entryIssue = validateEntry(individual, selectedEmployee?.name ?? "Employee");
    if (issue || entryIssue) {
      notify(issue || entryIssue, "warn");
      return;
    }
    try {
      await onSave([
        {
          employee_id: selectedEmployee!.id,
          site: site.trim(),
          foreman: foreman.trim(),
          work_date: workDate,
          in_time: individual.inTime,
          out_time: individual.outTime,
          break_hours: Number(individual.breakHours),
        },
      ]);
      notify("Attendance entry saved.");
      setIndividual(emptyEntry);
      setEmployeeId("");
      setEmployeeSearch("");
    } catch (saveError) {
      notify(
        saveError instanceof Error ? saveError.message : "Could not save the attendance entry.",
        "warn",
      );
    }
  };

  const updateBulkEntry = (id: number, patch: Partial<AttendanceInput>) => {
    setBulkEntries((entries) => ({
      ...entries,
      [id]: { ...emptyEntry, ...entries[id], ...patch },
    }));
  };

  const saveBulk = async () => {
    const commonIssue = commonError();
    if (commonIssue) {
      notify(commonIssue, "warn");
      return;
    }
    const touched = crewEmployees.filter((employee) => {
      const entry = bulkEntries[employee.id];
      return entry && (entry.inTime || entry.outTime || Number(entry.breakHours) !== 0);
    });
    if (!touched.length) {
      notify("Enter times for at least one employee before saving.", "warn");
      return;
    }
    const issue = touched
      .map((employee) => validateEntry(bulkEntries[employee.id]!, employee.name))
      .find(Boolean);
    if (issue) {
      notify(issue, "warn");
      return;
    }

    try {
      await onSave(
        touched.map((employee) => {
          const entry = bulkEntries[employee.id]!;
          return {
            employee_id: employee.id,
            site: site.trim(),
            foreman: foreman.trim(),
            work_date: workDate,
            in_time: entry.inTime,
            out_time: entry.outTime,
            break_hours: Number(entry.breakHours),
          };
        }),
      );
      notify(`${touched.length} attendance entr${touched.length === 1 ? "y" : "ies"} saved.`);
      setBulkEntries({});
    } catch (saveError) {
      notify(
        saveError instanceof Error ? saveError.message : "Could not save bulk attendance.",
        "warn",
      );
    }
  };

  const renderEntryFields = (
    value: AttendanceInput,
    onChange: (patch: Partial<AttendanceInput>) => void,
    compact = false,
  ) => (
    <div className={`grid grid-cols-3 ${compact ? "min-w-[390px] gap-2" : "gap-3"}`}>
      {(
        [
          ["In time", "inTime"],
          ["Out time", "outTime"],
        ] as const
      ).map(([label, field]) => (
        <label key={field} className="block text-xs font-semibold text-slate-600">
          {label}
          <input
            required
            type="time"
            value={value[field]}
            onChange={(event) => onChange({ [field]: event.target.value })}
            className={(compact ? inputSm : input) + " mt-1"}
          />
        </label>
      ))}
      <label className="block text-xs font-semibold text-slate-600">
        Break (hrs)
        <input
          type="number"
          min="0"
          max="24"
          step="0.25"
          value={value.breakHours}
          onChange={(event) => onChange({ breakHours: event.target.value })}
          className={(compact ? inputSm : input) + " mt-1"}
        />
      </label>
    </div>
  );

  return (
    <section className="space-y-4">
      <header
        className={card + " flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <Clock3 size={20} />
          </div>
          <div>
            <h2 className="font-display text-lg font-extrabold text-navy">Daily timesheets</h2>
            <p className="text-xs text-muted-foreground">
              Record site attendance and review daily hours by crew.
            </p>
          </div>
        </div>
        <div className="flex rounded-lg border border-border bg-navy-soft/60 p-1">
          {(["individual", "bulk"] as const).map((entryMode) => (
            <button
              key={entryMode}
              type="button"
              onClick={() => setMode(entryMode)}
              aria-pressed={mode === entryMode}
              className={`rounded-md px-3 py-2 text-xs font-bold capitalize transition ${
                mode === entryMode
                  ? "bg-navy text-white shadow-sm"
                  : "text-slate-600 hover:text-navy"
              }`}
            >
              {entryMode === "bulk" ? "Site crew" : "Individual"}
            </button>
          ))}
        </div>
      </header>

      <div className={card + " space-y-4 p-4 sm:p-5"}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-semibold text-slate-600">
            Site name
            <input
              value={site}
              onChange={(event) => setSite(event.target.value)}
              list="timesheet-site-options"
              maxLength={120}
              placeholder="Enter site or project"
              className={input + " mt-1"}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Foreman name
            <input
              value={foreman}
              onChange={(event) => setForeman(event.target.value)}
              list="timesheet-foreman-options"
              maxLength={120}
              placeholder="Enter foreman"
              className={input + " mt-1"}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Work date
            <input
              required
              type="date"
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
              className={input + " mt-1"}
            />
          </label>
        </div>
        <datalist id="timesheet-site-options">
          {sites.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <datalist id="timesheet-foreman-options">
          {foremen.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          >
            Attendance data could not be loaded: {error}. New entries can still be saved.
          </p>
        )}

        {mode === "individual" ? (
          <form onSubmit={(event) => void saveIndividual(event)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <EmployeePicker
                  employees={activeEmployees}
                  search={employeeSearch}
                  onSearchChange={(value) => {
                    setEmployeeSearch(value);
                    setEmployeeId("");
                  }}
                  onSelect={(employee) => {
                    setEmployeeId(String(employee.id));
                    setEmployeeSearch(employeeLabel(employee));
                  }}
                  actionLabel="Select"
                  label="Employee"
                  placeholder="Search active employees by name, trade or ID…"
                />
              </div>
              <div className="flex items-end">
                {selectedEmployee && (
                  <p className="w-full rounded-lg bg-navy-soft px-3 py-2.5 text-xs text-navy">
                    Employee ID <strong>{selectedEmployee.id_number || selectedEmployee.id}</strong>
                  </p>
                )}
              </div>
            </div>
            {renderEntryFields(individual, (patch) =>
              setIndividual((entry) => ({ ...entry, ...patch })),
            )}
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Total working hours{" "}
                <strong className="font-display text-lg text-navy">
                  {hoursFor(individual).toFixed(2)}
                </strong>
              </p>
              <button type="submit" disabled={saving} className={btnGold}>
                <Check size={16} /> {saving ? "Saving…" : "Save attendance"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-navy">
              <Users size={17} /> Site crew{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({crewEmployees.length} selected of {activeEmployees.length} active)
              </span>
            </div>
            {loading ? (
              <div className="rounded-lg bg-navy-soft p-5 text-center text-sm text-muted-foreground">
                Loading employees…
              </div>
            ) : activeEmployees.length === 0 ? (
              <p className="rounded-lg bg-navy-soft p-5 text-center text-sm text-muted-foreground">
                No active employees are available.
              </p>
            ) : (
              <>
                <EmployeePicker
                  employees={activeEmployees}
                  excludeIds={crewEmployeeIds}
                  search={crewSearch}
                  onSearchChange={setCrewSearch}
                  onSelect={(employee) => {
                    setCrewEmployeeIds((ids) =>
                      ids.includes(employee.id) ? ids : [...ids, employee.id],
                    );
                    setCrewSearch("");
                  }}
                  actionLabel="Add"
                  label="Add employees to this crew"
                  placeholder="Search by employee name, trade or ID…"
                />
                {crewEmployees.length === 0 ? (
                  <p className="rounded-lg bg-navy-soft p-5 text-center text-sm text-muted-foreground">
                    Search for an active employee above and add them to this crew.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-navy-soft text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5">Employee</th>
                          <th className="px-3 py-2.5">Times and break</th>
                          <th className="px-3 py-2.5 text-right">Hours</th>
                          <th className="px-3 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {crewEmployees.map((employee) => {
                          const entry = bulkEntries[employee.id] ?? emptyEntry;
                          return (
                            <tr key={employee.id} className="border-t border-border">
                              <td className="px-3 py-3">
                                <p className="font-semibold text-navy">{employee.name}</p>
                                <p className="text-xs text-muted-foreground">{employee.trade}</p>
                              </td>
                              <td className="px-3 py-2">
                                {renderEntryFields(
                                  entry,
                                  (patch) => updateBulkEntry(employee.id, patch),
                                  true,
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-bold text-navy">
                                {hoursFor(entry).toFixed(2)}
                              </td>
                              <td className="px-3 py-3 text-right">
                                <button
                                  type="button"
                                  aria-label={`Remove ${employee.name} from site crew`}
                                  title="Remove from crew"
                                  onClick={() => {
                                    setCrewEmployeeIds((ids) =>
                                      ids.filter((id) => id !== employee.id),
                                    );
                                    setBulkEntries((entries) => {
                                      const next = { ...entries };
                                      delete next[employee.id];
                                      return next;
                                    });
                                  }}
                                  className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 transition hover:bg-danger/10 hover:text-danger"
                                >
                                  <X size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Blank employee rows are skipped. Saving again for the same date updates that
                employee’s entry.
              </p>
              <button
                type="button"
                onClick={() => void saveBulk()}
                disabled={saving || loading || Boolean(error)}
                className={btnGold}
              >
                <HardHat size={16} /> {saving ? "Saving crew…" : "Save crew attendance"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function employeeLabel(employee: Employee) {
  return `${employee.name} — ${employee.trade}`;
}

function EmployeePicker({
  employees,
  excludeIds = [],
  search,
  onSearchChange,
  onSelect,
  actionLabel,
  label,
  placeholder,
}: {
  employees: Employee[];
  excludeIds?: number[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (employee: Employee) => void;
  actionLabel: "Select" | "Add";
  label: string;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];

    return employees
      .filter((employee) => !excludeIds.includes(employee.id))
      .filter((employee) =>
        [employee.name, employee.trade, employee.id_number, String(employee.id)]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 30);
  }, [employees, excludeIds, search]);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setIsOpen(false);
        }
      }}
    >
      <label className="block text-xs font-semibold text-slate-600">
        {label}
        <div className="relative mt-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label={label}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className={input + " pl-9"}
          />
        </div>
      </label>
      {isOpen && search.trim() && (
        <div
          role="region"
          aria-label={`${label} matches`}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {matches.length ? (
            <>
              {matches.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => {
                    onSelect(employee);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition hover:bg-navy-soft"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy">
                      {employee.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {employee.trade} · ID {employee.id_number || employee.id}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-navy">
                    <Plus size={14} />
                    {actionLabel}
                  </span>
                </button>
              ))}
              {matches.length === 30 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Showing the first 30 matches. Refine your search to find others.
                </p>
              )}
            </>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No active employee matches “{search.trim()}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
