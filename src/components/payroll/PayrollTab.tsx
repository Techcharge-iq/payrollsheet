import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  HardHat,
  Pencil,
  Plus,
  Save,
  Search,
  Share2,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import {
  computeNet,
  fmt,
  advanceCarryForwardFromBalance,
  calculatePayroll,
  currentPayrollMonth,
  lineGross,
  lockedEmployeeIds,
  monthLabel,
  payrollMonthOptions,
  PAYROLL_POLICY,
  PAYROLL_CALCULATION_VERSION,
  type PayrollBatchStatus,
  toNum,
  type AdvanceTx,
  type Employee,
  type PayrollBatch,
  type PayrollLine,
} from "@/lib/payroll";
import {
  useBatches,
  usePayrollAdvanceBalancesBefore,
  useTimesheetsForMonth,
} from "@/lib/payroll-data";
import { downloadPayrollImportTemplate, readPayrollImport } from "@/lib/payroll-excel";
import {
  downloadPayrollBatch,
  payrollBatchBlob,
  payrollBatchFilename,
} from "@/lib/payroll-batch-pdf";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { btnGold, btnIcon, btnOutline, btnPrimary, card, input, inputSm, select } from "./ui";
import { NewAdvanceValue } from "./NewAdvanceValue";
import { dbAny } from "@/integrations/supabase/external-client";

interface Props {
  employees: Employee[];
  advances: AdvanceTx[];
  onSave: (batch: PayrollBatch) => Promise<void>;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: PayrollBatchStatus) => Promise<void>;
  canDelete: boolean;
  saving: boolean;
  notify: (msg: string, tone?: "ok" | "warn") => void;
  onNewEmployee?: () => void;
}

interface EmployeeSearchProps {
  employees: Employee[];
  locked: Set<string>;
  value: number | "";
  onPick: (value: string) => void;
}

function EmployeeSearchSelect({ employees, locked, value, onPick }: EmployeeSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    position: "absolute" | "fixed";
  } | null>(null);
  const selected = employees.find((e) => String(e.id) === String(value));

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) return;
      const dialog = boxRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (dialog) {
        const dialogRect = dialog.getBoundingClientRect();
        setRect({
          top: r.bottom - dialogRect.top - dialog.clientTop + 4,
          left: r.left - dialogRect.left - dialog.clientLeft,
          width: Math.max(r.width, 240),
          position: "absolute",
        });
      } else {
        setRect({
          top: r.bottom + 4,
          left: r.left,
          width: Math.max(r.width, 240),
          position: "fixed",
        });
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.trade.toLowerCase().includes(q) ||
          String(e.id_number ?? "")
            .toLowerCase()
            .includes(q) ||
          String(e.id).includes(q),
      )
      .slice(0, 40);
  }, [employees, query]);
  const selectableResults = useMemo(
    () => results.filter((e) => !locked.has(String(e.id))),
    [results, locked],
  );

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const highlighted = selectableResults[highlightedIndex];
    const listElement = listRef.current;
    const optionElement = highlighted ? optionRefs.current.get(highlighted.id) : null;
    if (listElement && optionElement) {
      const listRect = listElement.getBoundingClientRect();
      const optionRect = optionElement.getBoundingClientRect();
      if (optionRect.top < listRect.top) {
        listElement.scrollTop -= listRect.top - optionRect.top;
      } else if (optionRect.bottom > listRect.bottom) {
        listElement.scrollTop += optionRect.bottom - listRect.bottom;
      }
    }
  }, [open, highlightedIndex, selectableResults]);

  useEffect(() => {
    if (restoreFocus.current && selected && !open) {
      restoreFocus.current = false;
      selectedButtonRef.current?.focus();
    }
  }, [open, selected]);

  const chooseEmployee = (employeeId: number) => {
    restoreFocus.current = true;
    onPick(String(employeeId));
    setOpen(false);
    setQuery("");
  };

  if (selected && !open) {
    return (
      <div className="flex min-w-47.5 items-center justify-between gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs">
        <span className="font-semibold text-navy">
          {selected.name} <span className="font-normal text-slate-400">— {selected.trade}</span>
        </span>
        <button
          ref={selectedButtonRef}
          type="button"
          title="Change employee"
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
          className="text-slate-400 hover:text-gold-dark"
        >
          <Search size={13} />
        </button>
      </div>
    );
  }

  const list = (
    <div
      ref={listRef}
      onMouseDown={(event) => event.preventDefault()}
      style={
        rect
          ? {
              position: rect.position,
              top: rect.top,
              left: rect.left,
              width: rect.width,
            }
          : undefined
      }
      className="employee-picker-sheet z-[70] max-h-64 overflow-auto rounded-md border border-border bg-card shadow-xl"
    >
      {results.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-slate-400">No matching employee.</p>
      ) : (
        results.map((e) => {
          const isLocked = locked.has(String(e.id));
          return (
            <button
              key={e.id}
              type="button"
              ref={(element) => {
                if (element) optionRefs.current.set(e.id, element);
                else optionRefs.current.delete(e.id);
              }}
              disabled={isLocked}
              onClick={() => chooseEmployee(e.id)}
              className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-navy-soft disabled:cursor-not-allowed disabled:opacity-45 ${
                selectableResults[highlightedIndex]?.id === e.id ? "bg-navy-soft" : ""
              }`}
              aria-selected={selectableResults[highlightedIndex]?.id === e.id}
            >
              <span className="font-semibold text-navy">
                {e.name} <span className="font-normal text-slate-400">— {e.trade}</span>
              </span>
              {isLocked && (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-warn">
                  <CheckCircle2 size={10} /> paid
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div ref={boxRef} className="relative min-w-47.5">
      <Search
        size={13}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlightedIndex((index) =>
              selectableResults.length
                ? index < 0 || index >= selectableResults.length - 1
                  ? 0
                  : index + 1
                : -1,
            );
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setHighlightedIndex((index) =>
              selectableResults.length
                ? index <= 0
                  ? selectableResults.length - 1
                  : index - 1
                : -1,
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            const employee =
              selectableResults[highlightedIndex] ??
              (highlightedIndex === -1 ? selectableResults[0] : undefined);
            if (employee) {
              chooseEmployee(employee.id);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search name, trade or ID…"
        className={inputSm + " w-full pl-7"}
      />
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          list,
          boxRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
        )}
    </div>
  );
}

function empIdLabel(employees: Employee[], id: number | "") {
  if (id === "") return "—";
  const e = employees.find((x) => String(x.id) === String(id));
  return e?.id_number?.trim() ? e.id_number.trim() : "Not Assigned";
}

function effectiveRateForMonth(
  employeeId: number,
  month: string,
  salaryHistory: Array<{
    employee_id: number;
    hourly_rate: number;
    effective_on: string;
    created_at?: string;
  }>,
) {
  return salaryHistory
    .filter(
      (record) => record.employee_id === employeeId && record.effective_on.slice(0, 7) <= month,
    )
    .sort(
      (a, b) =>
        b.effective_on.localeCompare(a.effective_on) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )[0]?.hourly_rate;
}

function effectiveRateOnDate(
  employeeId: number,
  workDate: string,
  salaryHistory: Array<{
    employee_id: number;
    hourly_rate: number;
    effective_on: string;
    created_at?: string;
  }>,
) {
  return salaryHistory
    .filter((record) => record.employee_id === employeeId && record.effective_on <= workDate)
    .sort(
      (a, b) =>
        b.effective_on.localeCompare(a.effective_on) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )[0]?.hourly_rate;
}

const emptyLine = (): PayrollLine => ({
  employee_id: "",
  foreman: "",
  hours: "",
  rate: "",
  food_deduction: "",
  prev_advance: "",
  new_advance: "",
  other_deduction: "",
  net_salary: 0,
  paid: "",
});

const numericFields = [
  ["hours", "Hours", true],
  ["rate", "Rate", true],
  ["food_deduction", "Food deduction", false],
  ["prev_advance", "Previous advance", false],
  ["new_advance", "New advance", false],
  ["other_deduction", "Other deduction", false],
  ["paid", "Paid", false],
] as const;

function lineHasValues(line: PayrollLine) {
  return (
    Boolean(line.foreman.trim()) ||
    numericFields.some(([field]) => String(line[field] ?? "").trim() !== "")
  );
}

function validateBatch(
  draft: PayrollBatch,
  month: string,
  employees: Employee[],
  carryForward: (employeeId: number | string) => number,
  locked: Set<string>,
  policy = PAYROLL_POLICY,
) {
  const errors: string[] = [];
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    errors.push("Select a valid payroll month.");
  }
  if (!draft.site.trim()) errors.push("Enter a site or project name.");

  const selectedIds = new Set<string>();
  let selectedCount = 0;
  draft.lines.forEach((line, index) => {
    const row = index + 1;
    if (line.employee_id === "") {
      if (lineHasValues(line)) errors.push(`Line ${row}: choose an employee or remove this line.`);
      return;
    }

    selectedCount += 1;
    const employeeId = String(line.employee_id);
    const employee = employees.find((item) => String(item.id) === employeeId);
    if (!employee) errors.push(`Line ${row}: the selected employee no longer exists.`);
    else {
      if (employee.status !== "Active") {
        errors.push(`Line ${row}: ${employee.name} is not active.`);
      }
      if (toNum(line.rate) <= 0) {
        errors.push(`Line ${row}: employee payroll rate must be greater than zero.`);
      }
    }
    if (selectedIds.has(employeeId)) {
      errors.push(`Line ${row}: this employee is listed more than once.`);
    }
    selectedIds.add(employeeId);
    if (locked.has(employeeId)) {
      errors.push(
        `Line ${row}: this employee is already in another batch for ${monthLabel(month)}.`,
      );
    }

    numericFields.forEach(([field, label, required]) => {
      const raw = String(line[field] ?? "").trim();
      if (!raw) {
        if (required) errors.push(`Line ${row}: enter ${label.toLowerCase()}.`);
        return;
      }
      const amount = Number(raw);
      if (!Number.isFinite(amount)) {
        errors.push(`Line ${row}: ${label.toLowerCase()} must be a valid number.`);
      } else if (amount < 0) {
        errors.push(`Line ${row}: ${label.toLowerCase()} cannot be negative.`);
      }
    });

    const gross = lineGross(line);
    const deductions =
      toNum(line.food_deduction) + toNum(line.prev_advance) + toNum(line.other_deduction);
    if (deductions > gross + 0.001) errors.push(`Line ${row}: deductions exceed gross pay.`);
    if (
      toNum(line.overtime_hours) > 0 &&
      (line.overtime_multiplier ?? policy.overtimeMultiplier) === null
    ) {
      errors.push(`Line ${row}: configure the overtime multiplier before saving overtime pay.`);
    }
    if (toNum(line.paid) > toNum(line.net_salary) + 0.001) {
      errors.push(`Line ${row}: paid amount exceeds net salary.`);
    }
    if (employee) {
      const availableAdvance = carryForward(employee.id) + toNum(line.new_advance);
      if (toNum(line.prev_advance) > availableAdvance + 0.001) {
        errors.push(`Line ${row}: previous advance deduction exceeds the outstanding advance.`);
      }
    }
  });

  if (!selectedCount) errors.push("Add at least one employee before saving.");
  return errors;
}

export function PayrollTab({
  employees,
  advances,
  onSave,
  onDelete,
  onStatus,
  canDelete,
  saving,
  notify,
  onNewEmployee,
}: Props) {
  const [month, setMonth] = useState(currentPayrollMonth);
  const isMissingPayrollSettingsError = (
    error: { code?: string; message?: string; status?: number } | null,
  ) =>
    !error ||
    error.code === "PGRST116" ||
    error.code === "42P01" ||
    error.status === 404 ||
    /payroll_settings|does not exist|not found/i.test(error.message ?? "");

  const timesheetsQuery = useTimesheetsForMonth(month);
  const timesheets = useMemo(() => timesheetsQuery.data ?? [], [timesheetsQuery.data]);
  const timesheetsLoading = timesheetsQuery.isLoading;
  const timesheetsError =
    timesheetsQuery.error instanceof Error ? timesheetsQuery.error.message : "";
  const batchesQuery = useBatches(month);
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const payrollSettingsQuery = useQuery({
    queryKey: ["payroll_settings"],
    queryFn: async (): Promise<{ overtime_multiplier: number | null }> => {
      const { data, error } = await dbAny
        .from("payroll_settings")
        .select("overtime_multiplier")
        .eq("singleton", true)
        .maybeSingle();
      if (error && !isMissingPayrollSettingsError(error)) throw error;
      return (data as { overtime_multiplier: number | null } | null) ?? {
        overtime_multiplier: null,
      };
    },
  });
  const payrollPolicy = useMemo(
    () => ({
      ...PAYROLL_POLICY,
      overtimeMultiplier: payrollSettingsQuery.data?.overtime_multiplier ?? null,
    }),
    [payrollSettingsQuery.data],
  );
  const salaryHistoryQuery = useQuery({
    queryKey: ["employee_salary_history"],
    queryFn: async (): Promise<
      Array<{ employee_id: number; hourly_rate: number; effective_on: string; created_at: string }>
    > => {
      const { data, error } = await dbAny
        .from("employee_salary_history")
        .select("employee_id, hourly_rate, effective_on, created_at")
        .order("effective_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        employee_id: number;
        hourly_rate: number;
        effective_on: string;
        created_at: string;
      }>;
    },
  });
  const salaryHistory = salaryHistoryQuery.data ?? [];
  const advanceBalancesQuery = usePayrollAdvanceBalancesBefore(month);
  const historicalAdvanceBalances = useMemo(
    () =>
      new Map((advanceBalancesQuery.data ?? []).map((entry) => [entry.employee_id, entry.balance])),
    [advanceBalancesQuery.data],
  );
  const carryForward = useCallback(
    (employeeId: number | string) =>
      advanceCarryForwardFromBalance(
        employeeId,
        month,
        historicalAdvanceBalances.get(Number(employeeId)) ?? 0,
        advances,
      ),
    [advances, historicalAdvanceBalances, month],
  );
  const [draft, setDraft] = useState<PayrollBatch | null>(null);
  const [viewingBatch, setViewingBatch] = useState<PayrollBatch | null>(null);
  const [foremanLine, setForemanLine] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const monthBatches = useMemo(() => batches.filter((b) => b.month === month), [batches, month]);
  const monthSummary = useMemo(
    () =>
      monthBatches.reduce(
        (summary, batch) => {
          summary.employees += batch.lines.length;
          batch.lines.forEach((line) => {
            summary.net += toNum(line.net_salary);
            summary.paid += toNum(line.paid);
          });
          return summary;
        },
        { employees: 0, net: 0, paid: 0 },
      ),
    [monthBatches],
  );

  const locked = useMemo(
    () => lockedEmployeeIds(batches, month, draft?.id ?? null),
    [batches, month, draft?.id],
  );

  const foremen = useMemo(() => {
    const set = new Set<string>();
    employees.filter((e) => e.trade === "FORMAN").forEach((e) => set.add(e.name));
    batches.forEach((b) => {
      if (b.foreman) set.add(b.foreman);
      b.lines.forEach((l) => l.foreman && set.add(l.foreman));
    });
    return [...set].sort();
  }, [employees, batches]);

  useEffect(() => {
    setDraft(null);
    setForemanLine(null);
  }, [month]);

  const startNew = () => {
    setImportErrors([]);
    setSubmitError("");
    setDraft({ id: "", month, site: "", foreman: "", status: "DRAFT", lines: [emptyLine()] });
  };

  const generateFromTimesheets = () => {
    if (batchesQuery.error || advanceBalancesQuery.error || salaryHistoryQuery.error) {
      notify(
        `Could not load payroll safeguards: ${
          (batchesQuery.error ?? advanceBalancesQuery.error ?? salaryHistoryQuery.error)?.message ??
          "Unknown error"
        }`,
        "warn",
      );
      return;
    }
    if (batchesQuery.isLoading || advanceBalancesQuery.isLoading || salaryHistoryQuery.isLoading) {
      notify("Payroll safeguards are still loading. Try again in a moment.", "warn");
      return;
    }
    if (timesheetsError) {
      notify(`Could not load timesheets: ${timesheetsError}`, "warn");
      return;
    }
    if (timesheetsLoading) {
      notify("Timesheet data is still loading. Try again in a moment.", "warn");
      return;
    }
    const monthlyEntries = timesheets.filter((entry) => entry.work_date.startsWith(`${month}-`));
    if (!monthlyEntries.length) {
      notify(`No timesheet entries found for ${monthLabel(month)}.`, "warn");
      return;
    }

    const totals = new Map<
      number,
      { regularHours: number; overtimeHours: number; foremen: Set<string> }
    >();
    monthlyEntries.forEach((entry) => {
      const total = totals.get(entry.employee_id) ?? {
        regularHours: 0,
        overtimeHours: 0,
        foremen: new Set<string>(),
      };
      total.regularHours += Number(entry.regular_hours);
      total.overtimeHours += Number(entry.overtime_hours);
      total.foremen.add(entry.foreman);
      totals.set(entry.employee_id, total);
    });

    let skipped = 0;
    const lines: PayrollLine[] = [];
    const inactive: string[] = [];
    totals.forEach((total, employeeId) => {
      if (locked.has(String(employeeId))) {
        skipped += 1;
        return;
      }
      const employee = employees.find((item) => item.id === employeeId);
      if (!employee) {
        skipped += 1;
        return;
      }
      if (employee.status !== "Active") {
        inactive.push(employee.name);
        return;
      }
      const rateSegmentsByRate = new Map<number, { regularHours: number; overtimeHours: number }>();
      let missingRateDate: string | null = null;
      monthlyEntries
        .filter((entry) => entry.employee_id === employee.id)
        .forEach((entry) => {
          const regularHours = Number(entry.regular_hours ?? 0);
          const overtimeHours = Number(entry.overtime_hours ?? 0);
          if (regularHours + overtimeHours <= 0) return;
          const rate = effectiveRateOnDate(employee.id, entry.work_date, salaryHistory);
          if (rate === undefined || rate <= 0) {
            missingRateDate = entry.work_date;
            return;
          }
          const segment = rateSegmentsByRate.get(rate) ?? { regularHours: 0, overtimeHours: 0 };
          segment.regularHours += regularHours;
          segment.overtimeHours += overtimeHours;
          rateSegmentsByRate.set(rate, segment);
        });
      if (missingRateDate) {
        inactive.push(`${employee.name} (no recorded rate on ${missingRateDate})`);
        return;
      }
      const rateSegments = [...rateSegmentsByRate.entries()].map(([rate, hours]) => ({
        rate,
        ...hours,
      }));
      if (!rateSegments.length) return;
      const regularHours = rateSegments.reduce((sum, segment) => sum + segment.regularHours, 0);
      const overtimeHours = rateSegments.reduce((sum, segment) => sum + segment.overtimeHours, 0);
      const totalRateHours = regularHours + overtimeHours;
      const effectiveRate =
        rateSegments.reduce(
          (sum, segment) => sum + segment.rate * (segment.regularHours + segment.overtimeHours),
          0,
        ) / totalRateHours;
      if (total.overtimeHours > 0 && payrollPolicy.overtimeMultiplier === null) {
        return;
      }
      const outstanding = carryForward(employee.id);
      const calculation = calculatePayroll({
        regularHours,
        overtimeHours,
        rate: effectiveRate,
        rateSegments,
        allowances: 0,
        deductions: 0,
        advanceRecovery: 0,
        policy: payrollPolicy,
      });
      const advanceRecovery = Math.min(outstanding, calculation.grossPay);
      const finalCalculation = calculatePayroll({
        regularHours,
        overtimeHours,
        rate: effectiveRate,
        rateSegments,
        allowances: 0,
        deductions: 0,
        advanceRecovery,
        policy: payrollPolicy,
      });
      const line: PayrollLine = {
        employee_id: employee.id,
        foreman: total.foremen.size === 1 ? [...total.foremen][0]! : "Multiple foremen",
        hours: Number((total.regularHours + total.overtimeHours).toFixed(3)),
        rate: effectiveRate,
        rate_segments: rateSegments,
        food_deduction: 0,
        prev_advance: advanceRecovery,
        new_advance: 0,
        other_deduction: 0,
        net_salary: finalCalculation.netPay,
        paid: 0,
        calculation_version: PAYROLL_CALCULATION_VERSION,
        overtime_multiplier: payrollPolicy.overtimeMultiplier,
        regular_hours: finalCalculation.regularHours,
        overtime_hours: finalCalculation.overtimeHours,
        regular_pay: finalCalculation.regularPay,
        overtime_pay: finalCalculation.overtimePay,
        allowances: finalCalculation.allowances,
        gross_pay: finalCalculation.grossPay,
        deductions: finalCalculation.deductions,
        advance_recovery: finalCalculation.advanceRecovery,
        net_pay: finalCalculation.netPay,
      };
      lines.push(line);
    });

    const blockedByOvertimePolicy = [...totals.values()].some(
      (total) => total.overtimeHours > 0 && payrollPolicy.overtimeMultiplier === null,
    );
    if (blockedByOvertimePolicy) {
      notify(
        "Payroll was not generated because attendance includes overtime and no overtime multiplier is configured.",
        "warn",
      );
      return;
    }

    if (!lines.length) {
      notify(
        "All employees with timesheets are already included in another payroll batch.",
        "warn",
      );
      return;
    }

    setImportErrors([]);
    setSubmitError("");
    const missingAttendance = employees.filter(
      (employee) => employee.status === "Active" && !totals.has(employee.id),
    ).length;
    setDraft({ id: "", month, site: "Multiple sites", foreman: "", status: "DRAFT", lines });
    notify(
      `${lines.length} employee payroll line(s) generated for review.${skipped ? ` ${skipped} already included or unavailable employee(s) skipped.` : ""}${missingAttendance ? ` ${missingAttendance} active employee(s) had no recorded attendance and were not added.` : ""}${inactive.length ? ` ${inactive.length} inactive or unconfigured employee(s) need review.` : ""}`,
      skipped || missingAttendance > 0 || inactive.length > 0 ? "warn" : "ok",
    );
  };

  const startEdit = (batch: PayrollBatch) => {
    setImportErrors([]);
    setSubmitError("");
    if (!canDelete && !["DRAFT", "REVIEW"].includes(batch.status)) {
      notify(`Payroll batch in ${batch.status} status cannot be edited.`, "warn");
      return;
    }
    setDraft(batch);
  };

  const closeEditor = () => {
    if (saving || isImporting) return;
    setDraft(null);
    setImportErrors([]);
    setSubmitError("");
  };

  const validationErrors = useMemo(
    () =>
      draft ? validateBatch(draft, month, employees, carryForward, locked, payrollPolicy) : [],
    [draft, month, employees, carryForward, locked, payrollPolicy],
  );

  const importFile = async (file: File) => {
    setIsImporting(true);
    setImportErrors([]);
    setSubmitError("");
    try {
      const rows = await readPayrollImport(file);
      if (!rows.length) throw new Error("The file does not contain any payroll rows.");

      const issues: string[] = [];
      const imported: PayrollLine[] = [];
      const employeeIds = new Set(
        (draft?.lines ?? [])
          .filter((line) => line.employee_id !== "")
          .map((line) => String(line.employee_id)),
      );

      rows.forEach(({ rowNumber, values }) => {
        const databaseId =
          values["databaseid"] || values["internalid"] || values["employeeinternalid"];
        const empId =
          values["employeeid"] ||
          values["empid"] ||
          values["employeenumber"] ||
          values["employeeno"] ||
          values["idnumber"];
        const name = values["employee"] || values["name"] || values["employeename"];
        const selectors = [
          databaseId ? employees.filter((employee) => String(employee.id) === databaseId) : null,
          empId
            ? employees.filter(
                (employee) => employee.id_number.trim().toLowerCase() === empId.toLowerCase(),
              )
            : null,
          name
            ? employees.filter(
                (employee) => employee.name.trim().toLowerCase() === name.toLowerCase(),
              )
            : null,
        ].filter((matches): matches is Employee[] => matches !== null);
        let matchedEmployees = selectors[0] ?? [];
        for (const matches of selectors.slice(1)) {
          const matchingIds = new Set(matches.map((employee) => employee.id));
          matchedEmployees = matchedEmployees.filter((employee) => matchingIds.has(employee.id));
        }
        if (!selectors.length || matchedEmployees.length !== 1) {
          issues.push(
            `Row ${rowNumber}: ${
              matchedEmployees.length > 1
                ? "employee ID and name point to different or duplicate employees."
                : "employee was not found. Use Employee ID, Emp ID, or an exact employee name."
            }`,
          );
          return;
        }

        const employee = matchedEmployees[0]!;
        if (locked.has(String(employee.id))) {
          issues.push(`Row ${rowNumber}: ${employee.name} is already in another batch this month.`);
          return;
        }
        if (employeeIds.has(String(employee.id))) {
          issues.push(`Row ${rowNumber}: ${employee.name} appears more than once in this batch.`);
          return;
        }

        const issuesBeforeNumbers = issues.length;
        const readNumber = (label: string, keys: string[], required = false) => {
          const raw = keys.map((key) => values[key]).find((value) => value !== undefined) ?? "";
          if (!raw.trim()) {
            if (required) issues.push(`Row ${rowNumber}: ${label} is required.`);
            return 0;
          }
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed < 0) {
            issues.push(`Row ${rowNumber}: ${label} must be a valid non-negative number.`);
            return 0;
          }
          return parsed;
        };

        const hours = readNumber("Hours", ["hours"], true);
        const rate = readNumber("Rate", ["rate"]);
        const food = readNumber("Food deduction", ["fooddeduction", "food", "fooddeduct"]);
        const previousAdvance = readNumber("Previous advance", [
          "previousadvance",
          "prevadvance",
          "prevadv",
        ]);
        const newAdvance = readNumber("New advance", ["newadvance", "newadv"]);
        const otherDeduction = readNumber("Other deduction", ["otherdeduction", "otherdeduct"]);
        const paid = readNumber("Paid", ["paid"]);
        if (issues.length > issuesBeforeNumbers) return;

        const line: PayrollLine = {
          employee_id: employee.id,
          foreman: values["foreman"] || draft?.foreman || "",
          hours,
          rate: values["rate"]?.trim()
            ? rate
            : (effectiveRateForMonth(employee.id, month, salaryHistory) ?? ""),
          food_deduction: food,
          prev_advance:
            values["previousadvance"] || values["prevadvance"] || values["prevadv"]
              ? previousAdvance
              : carryForward(employee.id),
          new_advance: newAdvance,
          other_deduction: otherDeduction,
          net_salary: 0,
          paid,
        };
        line.net_salary = computeNet(line);
        imported.push(line);
        employeeIds.add(String(employee.id));
      });

      if (issues.length) {
        setImportErrors(issues);
        return;
      }
      if (!imported.length) {
        setImportErrors(["The file did not contain any usable employee rows."]);
        return;
      }

      setDraft((current) =>
        current
          ? {
              ...current,
              lines: [
                ...current.lines.filter((line) => line.employee_id !== "" || lineHasValues(line)),
                ...imported,
              ],
            }
          : current,
      );
      notify(`${imported.length} employee row(s) imported.`);
    } catch (error) {
      setImportErrors([
        error instanceof Error
          ? error.message
          : "Could not read this file. Check it and try again.",
      ]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsImporting(false);
    }
  };

  const setLine = (idx: number, patch: Partial<PayrollLine>) => {
    setDraft((d) => {
      if (!d) return d;
      const lines = d.lines.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        if (
          patch.hours !== undefined ||
          patch.overtime_hours !== undefined ||
          patch.rate !== undefined
        ) {
          next.rate_segments = null;
        }
        if (next.calculation_version) {
          const overtimeHours = toNum(next.overtime_hours);
          const regularHours =
            patch.hours !== undefined
              ? Math.max(0, toNum(next.hours) - overtimeHours)
              : toNum(next.regular_hours);
          const calculation = calculatePayroll({
            regularHours,
            overtimeHours,
            rate: toNum(next.rate),
            rateSegments: next.rate_segments ?? undefined,
            allowances: toNum(next.allowances),
            deductions: toNum(next.food_deduction) + toNum(next.other_deduction),
            advanceRecovery: toNum(next.prev_advance),
            policy: {
              ...payrollPolicy,
              overtimeMultiplier: next.overtime_multiplier ?? payrollPolicy.overtimeMultiplier,
            },
          });
          Object.assign(next, {
            hours: calculation.regularHours + calculation.overtimeHours,
            regular_hours: calculation.regularHours,
            overtime_hours: calculation.overtimeHours,
            regular_pay: calculation.regularPay,
            overtime_pay: calculation.overtimePay,
            allowances: calculation.allowances,
            gross_pay: calculation.grossPay,
            deductions: calculation.deductions,
            advance_recovery: calculation.advanceRecovery,
            net_pay: calculation.netPay,
            net_salary: calculation.netPay,
          });
        } else {
          next.net_salary = computeNet(next);
        }
        return next;
      });
      return { ...d, lines };
    });
  };

  const pickEmployee = (idx: number, value: string) => {
    if (value && locked.has(value)) {
      notify("This employee is already in another payroll batch for this month.", "warn");
      return;
    }
    if (value && draft?.lines.some((l, i) => i !== idx && String(l.employee_id) === value)) {
      notify("This employee is already on this batch.", "warn");
      return;
    }
    const emp = employees.find((e) => String(e.id) === value);
    setLine(idx, {
      employee_id: value ? Number(value) : "",
      rate: emp ? (effectiveRateForMonth(emp.id, month, salaryHistory) ?? "") : "",
      prev_advance: emp ? carryForward(emp.id) : "",
    });
  };

  const totals = draft
    ? draft.lines.reduce(
        (acc, l) => ({
          gross: acc.gross + lineGross(l),
          net: acc.net + toNum(l.net_salary),
          paid: acc.paid + toNum(l.paid),
          balance: acc.balance + toNum(l.net_salary) - toNum(l.paid),
        }),
        { gross: 0, net: 0, paid: 0, balance: 0 },
      )
    : null;

  const save = async () => {
    if (!draft) return;
    if (isImporting || validationErrors.length || importErrors.length) return;
    setSubmitError("");
    try {
      await onSave({ ...draft, month });
      setDraft(null);
      setImportErrors([]);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save payroll batch.");
    }
  };

  const changeStatus = async (batch: PayrollBatch, status: PayrollBatchStatus) => {
    if (status === "APPROVED") {
      const otherBatchEmployees = lockedEmployeeIds(batches, batch.month, batch.id);
      const issues = validateBatch(
        batch,
        batch.month,
        employees,
        carryForward,
        otherBatchEmployees,
        payrollPolicy,
      );
      if (issues.length) {
        notify(`Payroll reconciliation failed: ${issues.slice(0, 3).join(" ")}`, "warn");
        return;
      }
      const snapshotIssues = batch.lines.flatMap((line, index) => {
        if (!line.calculation_version) return [];
        const calculation = calculatePayroll({
          regularHours:
            line.regular_hours === null || line.regular_hours === undefined
              ? Math.max(0, toNum(line.hours) - toNum(line.overtime_hours))
              : toNum(line.regular_hours),
          overtimeHours: toNum(line.overtime_hours),
          rate: toNum(line.rate),
          allowances: toNum(line.allowances),
          deductions: toNum(line.food_deduction) + toNum(line.other_deduction),
          advanceRecovery: toNum(line.prev_advance),
          rateSegments: line.rate_segments ?? undefined,
          policy: {
            ...payrollPolicy,
            overtimeMultiplier: line.overtime_multiplier ?? payrollPolicy.overtimeMultiplier,
          },
        });
        const comparisons: Array<[string, unknown, number]> = [
          ["gross", line.gross_pay, calculation.grossPay],
          ["deductions", line.deductions, calculation.deductions],
          ["advance recovery", line.advance_recovery, calculation.advanceRecovery],
          ["net", line.net_pay ?? line.net_salary, calculation.netPay],
        ];
        return comparisons
          .filter(
            ([_, actual, expected]) => actual == null || Math.abs(toNum(actual) - expected) > 0.001,
          )
          .map(([label]) => `Line ${index + 1}: ${label} does not match its calculation snapshot.`);
      });
      if (snapshotIssues.length) {
        notify(`Payroll reconciliation failed: ${snapshotIssues[0]}`, "warn");
        return;
      }
    }
    try {
      await onStatus(batch.id, status);
      notify(`Payroll batch status changed to ${status}.`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not change payroll batch status.",
        "warn",
      );
    }
  };

  const sharePayroll = async (batch: PayrollBatch) => {
    setSharing(true);
    try {
      const blob = payrollBatchBlob(batch, employees);
      const file = new File([blob], payrollBatchFilename(batch), { type: "application/pdf" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({
          title: `${batch.site || "Payroll"} — ${monthLabel(batch.month)}`,
          text: `Payroll report for ${batch.site || "site"}, ${monthLabel(batch.month)}.`,
          files: [file],
        });
        return;
      }
      downloadPayrollBatch(batch, employees);
      const message = encodeURIComponent(
        `Payroll report for ${batch.site || "site"}, ${monthLabel(batch.month)}. Please attach the downloaded PDF.`,
      );
      window.open(`https://wa.me/?text=${message}`, "_blank", "noopener,noreferrer");
      notify("The PDF was downloaded. Attach it in the WhatsApp window that opened.", "warn");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(error instanceof Error ? error.message : "Could not share the payroll PDF.", "warn");
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card + " mobile-toolbar flex flex-col gap-3 p-4 sm:flex-row sm:items-center"}>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payroll month
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={select + " sm:w-64"}
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={generateFromTimesheets}
          disabled={timesheetsLoading || Boolean(timesheetsError)}
          className={btnOutline}
        >
          <Clock3 size={15} />{" "}
          {timesheetsLoading ? "Loading timesheets…" : "Generate Batch from Timesheets"}
        </button>
        <button onClick={startNew} className={btnGold}>
          <Plus size={16} /> New payroll batch
        </button>
      </div>

      <section
        className="mobile-metric-grid grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label={`${monthLabel(month)} payroll summary`}
      >
        {[
          { label: "Payroll batches", value: String(monthBatches.length) },
          { label: "Employees included", value: String(monthSummary.employees) },
          { label: "Net payroll", value: `${fmt(monthSummary.net)} OMR` },
          { label: "Balance due", value: `${fmt(monthSummary.net - monthSummary.paid)} OMR` },
        ].map((item, index) => (
          <div
            key={item.label}
            className={`${card} mobile-metric p-3.5${index === 2 ? " mobile-metric-primary" : index === 3 && monthSummary.net > monthSummary.paid ? " mobile-metric-alert" : ""}`}
          >
            <p>{item.label}</p>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      {locked.size > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-medium text-slate-700">
          <CheckCircle2 size={14} className="text-gold-dark" />
          {locked.size} employee(s) already paid in another batch for {monthLabel(month)} — they are
          blocked here to prevent double payment.
        </p>
      )}

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        {draft && (
          <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
            <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
              <DialogTitle className="font-display text-xl font-extrabold text-navy">
                {draft.id ? "Edit payroll batch" : "Create payroll batch"}
              </DialogTitle>
              <DialogDescription>
                Review employee amounts and resolve any flagged issues before saving.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-end gap-3 border-b border-border bg-navy-soft px-4 py-3">
              <div className="min-w-40 flex-1">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Site
                </label>
                <input
                  value={draft.site}
                  onChange={(e) => setDraft({ ...draft, site: e.target.value })}
                  placeholder="Site / project"
                  className={input}
                />
              </div>
              <div className="min-w-40 flex-1">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Batch foreman (default)
                </label>
                <input
                  value={draft.foreman}
                  onChange={(e) => setDraft({ ...draft, foreman: e.target.value })}
                  placeholder="Foreman name"
                  list="foreman-options"
                  className={input}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                aria-label="Choose an Excel workbook or CSV file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void importFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting || saving}
                className={btnOutline}
              >
                <Upload size={15} /> {isImporting ? "Checking file…" : "Import Excel / CSV"}
              </button>
              <button type="button" onClick={downloadPayrollImportTemplate} className={btnOutline}>
                <Download size={15} /> Download template
              </button>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <FileSpreadsheet size={14} />
                Imports append checked rows from the first worksheet. Excel IDs must match employee
                records.
              </p>
            </div>

            {(validationErrors.length > 0 || importErrors.length > 0 || submitError) && (
              <div className="mx-4 mt-3 max-h-32 overflow-y-auto rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                <p className="mb-1 flex items-center gap-2 font-bold">
                  <AlertTriangle size={16} />
                  {importErrors.length
                    ? `${importErrors.length} spreadsheet issue(s) need attention`
                    : submitError
                      ? "The batch could not be saved"
                      : `${validationErrors.length} issue(s) to fix before saving`}
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-xs">
                  {submitError && <li>{submitError}</li>}
                  {importErrors.map((error, index) => (
                    <li key={`import-${index}`}>{error}</li>
                  ))}
                  {validationErrors.map((error, index) => (
                    <li key={`validation-${index}`}>{error}</li>
                  ))}
                </ul>
                {importErrors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setImportErrors([])}
                    className="mt-2 text-xs font-bold underline underline-offset-2"
                  >
                    Dismiss import issues
                  </button>
                )}
              </div>
            )}

            <datalist id="foreman-options">
              {foremen.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>

            <div className="min-h-0 flex-1 overflow-auto px-2 py-3 sm:px-4">
              <div className="hidden overflow-x-auto md:block xl:overflow-x-visible">
                <table className="w-full min-w-270 text-xs">
                  <thead className="bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                    <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-2 py-2">Emp ID</th>
                      <th className="px-2 py-2">Foreman</th>
                      <th className="px-2 py-2 text-right">Hours</th>
                      <th className="px-2 py-2 text-right">Rate</th>
                      <th className="px-2 py-2 text-right">Gross</th>
                      <th className="px-2 py-2 text-right">Food</th>
                      <th className="px-2 py-2 text-right">Prev adv.</th>
                      <th className="px-2 py-2 text-right">New adv.</th>
                      <th className="px-2 py-2 text-right">Other ded.</th>
                      <th className="px-2 py-2 text-right">Net</th>
                      <th className="px-2 py-2 text-right">Paid</th>
                      <th className="px-2 py-2 text-right">Balance</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((l, idx) => {
                      const carry = l.employee_id ? carryForward(l.employee_id) : 0;
                      return (
                        <tr key={idx} className="border-b border-border align-top last:border-0">
                          <td className="px-3 py-2">
                            <EmployeeSearchSelect
                              employees={employees}
                              locked={locked}
                              value={l.employee_id}
                              onPick={(v) => pickEmployee(idx, v)}
                            />
                            {l.employee_id !== "" && (carry > 0 || toNum(l.new_advance) > 0) && (
                              <div className="mt-1 space-y-0.5 text-[10px] font-semibold">
                                <p className="text-warn">
                                  Outstanding from previous months: {fmt(carry)}
                                </p>
                                <p className="text-slate-600">
                                  Deducting now: {fmt(Math.min(toNum(l.prev_advance), carry))} ·
                                  Carries to next month:{" "}
                                  {fmt(
                                    Math.max(
                                      0,
                                      carry - toNum(l.prev_advance) + toNum(l.new_advance),
                                    ),
                                  )}
                                </p>
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-600">
                            {empIdLabel(employees, l.employee_id)}
                          </td>
                          <td className="px-2 py-2">
                            {foremanLine === idx ? (
                              <input
                                autoFocus
                                value={l.foreman}
                                list="foreman-options"
                                onChange={(e) => setLine(idx, { foreman: e.target.value })}
                                onBlur={() => setForemanLine(null)}
                                className={inputSm + " min-w-30"}
                                placeholder="Line foreman"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setForemanLine(idx)}
                                title="Change foreman for this employee"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-gold hover:bg-gold/10"
                              >
                                <HardHat size={13} className="text-gold-dark" />
                                {l.foreman || draft.foreman || "Set"}
                              </button>
                            )}
                          </td>
                          {(["hours", "rate"] as const).map((f) => (
                            <td key={f} className="px-2 py-2">
                              <input
                                type="number"
                                step="0.01"
                                value={l[f] as string}
                                onChange={(e) => setLine(idx, { [f]: e.target.value })}
                                className={`${inputSm} w-20 text-right`}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right font-semibold text-navy">
                            {fmt(lineGross(l))}
                          </td>
                          {(
                            [
                              "food_deduction",
                              "prev_advance",
                              "new_advance",
                              "other_deduction",
                            ] as const
                          ).map((f) => (
                            <td key={f} className="px-2 py-2">
                              <input
                                type="number"
                                step="0.01"
                                value={l[f] as string}
                                onChange={(e) => setLine(idx, { [f]: e.target.value })}
                                className={`${inputSm} w-20 text-right ${f === "new_advance" && toNum(l.new_advance) > 0 ? "border-gold bg-gold/10 font-extrabold text-warn" : ""}`}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right font-bold text-money">
                            {fmt(toNum(l.net_salary))}
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={l.paid as string}
                              onChange={(e) => setLine(idx, { paid: e.target.value })}
                              className={inputSm + " w-20 text-right"}
                            />
                          </td>
                          <td className="px-2 py-2 text-right font-semibold">
                            {fmt(toNum(l.net_salary) - toNum(l.paid))}
                          </td>
                          <td className="px-2 py-2">
                            {(canDelete || !l.id) && (
                              <button
                                type="button"
                                title="Remove line"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    lines: draft.lines.filter((_, i) => i !== idx),
                                  })
                                }
                                className={btnIcon + " hover:border-danger hover:text-danger"}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totals && (
                    <tfoot>
                      <tr className="bg-navy-soft/70 font-bold text-navy">
                        <td className="px-3 py-2" colSpan={5}>
                          Totals
                        </td>
                        <td className="px-2 py-2 text-right">{fmt(totals.gross)}</td>
                        <td className="px-2 py-2" colSpan={4} />
                        <td className="px-2 py-2 text-right text-money">{fmt(totals.net)}</td>
                        <td className="px-2 py-2 text-right">{fmt(totals.paid)}</td>
                        <td className="px-2 py-2 text-right">{fmt(totals.balance)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Mobile: one card per employee */}
              <div className="space-y-3 p-3 md:hidden">
                {draft.lines.map((l, idx) => (
                  <div
                    key={idx}
                    className="mobile-payroll-card rounded-lg border border-border bg-card p-3 shadow-sm"
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <div className="flex-1">
                        <EmployeeSearchSelect
                          employees={employees}
                          locked={locked}
                          value={l.employee_id}
                          onPick={(v) => pickEmployee(idx, v)}
                        />
                        <p className="mt-1 font-mono text-[10px] text-slate-500">
                          ID {empIdLabel(employees, l.employee_id)}
                        </p>
                      </div>
                      {(canDelete || !l.id) && (
                        <button
                          type="button"
                          title="Remove line"
                          onClick={() =>
                            setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) })
                          }
                          className={btnIcon + " hover:border-danger hover:text-danger"}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>

                    <label className="mb-2 block">
                      <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase text-slate-500">
                        <HardHat size={12} className="text-gold-dark" /> Foreman
                      </span>
                      <input
                        value={l.foreman}
                        list="foreman-options"
                        onChange={(e) => setLine(idx, { foreman: e.target.value })}
                        placeholder={draft.foreman || "Foreman name"}
                        className={inputSm}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          ["hours", "Hours"],
                          ["rate", "Rate"],
                          ["food_deduction", "Food"],
                          ["prev_advance", "Prev adv."],
                          ["new_advance", "New adv."],
                          ["other_deduction", "Other ded."],
                          ["paid", "Paid"],
                        ] as const
                      ).map(([f, label]) => (
                        <label key={f} className="block">
                          <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                            {label}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={l[f] as string}
                            onChange={(e) => setLine(idx, { [f]: e.target.value })}
                            className={`${inputSm} text-right ${f === "new_advance" && toNum(l.new_advance) > 0 ? "border-gold bg-gold/10 font-extrabold text-warn" : ""}`}
                          />
                        </label>
                      ))}
                      <div className="self-end rounded-md bg-navy-soft px-3 py-2 text-right">
                        <span className="block text-[10px] font-bold uppercase text-slate-500">
                          Net
                        </span>
                        <span className="text-sm font-extrabold text-money">
                          {fmt(toNum(l.net_salary))}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 flex justify-between text-[11px] font-semibold text-slate-600">
                      <span>Gross {fmt(lineGross(l))}</span>
                      <span>Balance {fmt(toNum(l.net_salary) - toNum(l.paid))}</span>
                    </p>
                  </div>
                ))}

                {totals && (
                  <div className="rounded-lg bg-navy-soft/70 px-3 py-2 text-xs font-bold text-navy">
                    Totals — Gross {fmt(totals.gross)} · Net {fmt(totals.net)} · Paid{" "}
                    {fmt(totals.paid)} · Balance {fmt(totals.balance)}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}
                  className={btnOutline}
                >
                  <Plus size={15} /> Add employee line
                </button>
                {onNewEmployee && (
                  <button type="button" onClick={onNewEmployee} className={btnOutline}>
                    <UserPlus size={15} /> New employee
                  </button>
                )}
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-4 py-3">
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving || isImporting}
                className={btnOutline}
              >
                <X size={15} /> Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={
                  saving || isImporting || validationErrors.length > 0 || importErrors.length > 0
                }
                className={btnGold}
              >
                <Save size={15} /> {saving ? "Saving…" : "Save batch"}
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={Boolean(viewingBatch)}
        onOpenChange={(open) => {
          if (!open) setViewingBatch(null);
        }}
      >
        {viewingBatch && (
          <DialogContent className="max-h-[90vh] w-[96vw] max-w-5xl overflow-y-auto sm:rounded-2xl">
            <DialogHeader className="pr-8 text-left">
              <DialogTitle className="font-display text-xl font-extrabold text-navy">
                {viewingBatch.site || "Unnamed site"}
              </DialogTitle>
              <DialogDescription>
                {monthLabel(viewingBatch.month)} · Foreman {viewingBatch.foreman || "—"} ·{" "}
                {viewingBatch.lines.length} employee(s)
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void sharePayroll(viewingBatch)}
                disabled={sharing}
                className={btnGold}
              >
                <Share2 size={16} /> {sharing ? "Preparing PDF…" : "Share payroll"}
              </button>
              <button
                type="button"
                onClick={() => downloadPayrollBatch(viewingBatch, employees)}
                className={btnOutline}
              >
                <Download size={16} /> Download PDF
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: "Gross",
                  value: viewingBatch.lines.reduce((sum, line) => sum + lineGross(line), 0),
                },
                {
                  label: "Net payroll",
                  value: viewingBatch.lines.reduce((sum, line) => sum + toNum(line.net_salary), 0),
                },
                {
                  label: "Paid",
                  value: viewingBatch.lines.reduce((sum, line) => sum + toNum(line.paid), 0),
                },
                {
                  label: "Balance",
                  value: viewingBatch.lines.reduce(
                    (sum, line) => sum + toNum(line.net_salary) - toNum(line.paid),
                    0,
                  ),
                },
              ].map((total) => (
                <div key={total.label} className="rounded-xl bg-navy-soft/70 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {total.label}
                  </p>
                  <p className="mt-1 font-display text-lg font-extrabold text-navy">
                    {fmt(total.value)}
                  </p>
                </div>
              ))}
            </div>

            <div className="max-h-[52vh] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="sticky top-0 bg-navy-soft text-[10px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5">Employee</th>
                    <th className="px-3 py-2.5">Foreman</th>
                    <th className="px-3 py-2.5 text-right">Hours</th>
                    <th className="px-3 py-2.5 text-right">Rate</th>
                    <th className="px-3 py-2.5 text-right">Gross</th>
                    <th className="px-3 py-2.5 text-right">Food</th>
                    <th className="px-3 py-2.5 text-right">Prev. advance</th>
                    <th className="px-3 py-2.5 text-right">New advance</th>
                    <th className="px-3 py-2.5 text-right">Other deduction</th>
                    <th className="px-3 py-2.5 text-right">Net</th>
                    <th className="px-3 py-2.5 text-right">Paid</th>
                    <th className="px-3 py-2.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingBatch.lines.map((line, index) => {
                    const employee = employees.find(
                      (item) => String(item.id) === String(line.employee_id),
                    );
                    return (
                      <tr
                        key={line.id ?? `${line.employee_id}-${index}`}
                        className="border-t border-border"
                      >
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-navy">
                            {employee?.name ?? "Unknown employee"}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {employee?.trade ?? "—"} · ID {empIdLabel(employees, line.employee_id)}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          {line.foreman || viewingBatch.foreman || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(line.hours))}</td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(line.rate))}</td>
                        <td className="px-3 py-2.5 text-right font-medium">
                          {fmt(lineGross(line))}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {fmt(toNum(line.food_deduction))}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(line.prev_advance))}</td>
                        <td className="px-3 py-2.5 text-right">
                          <NewAdvanceValue value={line.new_advance} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {fmt(toNum(line.other_deduction))}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-money">
                          {fmt(toNum(line.net_salary))}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmt(toNum(line.paid))}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {fmt(toNum(line.net_salary) - toNum(line.paid))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <div className="space-y-3">
        {monthBatches.length === 0 && !draft && (
          <div className={card + " p-8 text-center text-sm text-slate-400"}>
            No payroll batches for {monthLabel(month)} yet.
          </div>
        )}
        {monthBatches.map((b) => {
          const net = b.lines.reduce((s, l) => s + toNum(l.net_salary), 0);
          const paid = b.lines.reduce((s, l) => s + toNum(l.paid), 0);
          const newAdvanceTotal = b.lines.reduce((sum, line) => sum + toNum(line.new_advance), 0);
          const newAdvanceCount = b.lines.filter((line) => toNum(line.new_advance) > 0).length;
          return (
            <div
              key={b.id}
              className={card + " mobile-batch-card flex flex-wrap items-center gap-3 p-4"}
            >
              <div className="flex-1">
                <p className="text-sm font-bold text-navy">{b.site || "Unnamed site"}</p>
                <p className="text-xs text-muted-foreground">
                  Foreman {b.foreman || "—"} · {b.lines.length} employees · {monthLabel(b.month)} ·{" "}
                  {b.status}
                </p>
                {newAdvanceCount > 0 && (
                  <p className="mt-1 inline-flex rounded-md bg-gold/15 px-2 py-1 text-[11px] font-extrabold text-warn">
                    {newAdvanceCount} new advance{newAdvanceCount === 1 ? "" : "s"} ·{" "}
                    {fmt(newAdvanceTotal)} OMR
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase text-slate-500">Net / Paid</p>
                <p className="text-sm font-extrabold text-money">
                  {fmt(net)} / {fmt(paid)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingBatch(b)}
                className={btnOutline}
                aria-label={`View ${b.site || "payroll batch"} details`}
              >
                <Eye size={14} /> View
              </button>
              {(canDelete || ["DRAFT", "REVIEW"].includes(b.status)) && (
                <button onClick={() => startEdit(b)} className={btnPrimary}>
                  <Pencil size={14} /> Edit
                </button>
              )}
              {canDelete && b.status === "DRAFT" && (
                <button
                  type="button"
                  onClick={() => void changeStatus(b, "REVIEW")}
                  className={btnOutline}
                >
                  <CheckCircle2 size={14} /> Submit review
                </button>
              )}
              {canDelete && b.status === "REVIEW" && (
                <>
                  <button
                    type="button"
                    onClick={() => void changeStatus(b, "DRAFT")}
                    className={btnOutline}
                  >
                    Return to draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void changeStatus(b, "APPROVED")}
                    className={btnPrimary}
                  >
                    Approve
                  </button>
                </>
              )}
              {canDelete && ["APPROVED", "LOCKED"].includes(b.status) && (
                <button
                  type="button"
                  onClick={() => void changeStatus(b, "PAID")}
                  className={btnPrimary}
                >
                  Mark paid
                </button>
              )}
              {canDelete && ["DRAFT", "REVIEW"].includes(b.status) && (
                <button
                  onClick={() => onDelete(b.id)}
                  className={btnOutline + " hover:border-danger hover:text-danger"}
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
