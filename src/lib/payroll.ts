export type EmployeeStatus = "Active" | "Holiday" | "Cancelled";

export interface Employee {
  id: number;
  name: string;
  trade: string;
  id_number: string;
  hourly_rate: number;
  status: EmployeeStatus;
}

export interface PayrollLine {
  id?: string;
  batch_id?: string;
  employee_id: number | "";
  foreman: string;
  hours: number | string;
  rate: number | string;
  food_deduction: number | string;
  prev_advance: number | string;
  new_advance: number | string;
  other_deduction: number | string;
  net_salary: number | string;
  paid: number | string;
}

export interface PayrollBatch {
  id: string;
  month: string;
  site: string;
  foreman: string;
  lines: PayrollLine[];
}

export const TRADES = ["CARPENTER", "STEEL FIXER", "HELPER", "MASON", "ELEC", "PLUB", "FORMAN"];

export const STATUSES: EmployeeStatus[] = ["Active", "Holiday", "Cancelled"];

export const MONTHS = [
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
  "2027-05",
  "2027-06",
];

export function currentPayrollMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function payrollMonthOptions() {
  return [...new Set([...MONTHS, currentPayrollMonth()])].sort();
}

export function monthLabel(m: string) {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function toNum(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function fmt(n: number) {
  return (Math.round(n * 1000) / 1000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

/** Gross = hours x rate */
export function lineGross(l: PayrollLine) {
  return toNum(l.hours) * toNum(l.rate);
}

/** Net salary payable = gross - food - recovered advance - other deductions */
export function computeNet(l: PayrollLine) {
  return Math.max(
    0,
    lineGross(l) - toNum(l.food_deduction) - toNum(l.prev_advance) - toNum(l.other_deduction),
  );
}

export function lineBalance(l: PayrollLine) {
  return toNum(l.net_salary) - toNum(l.paid);
}

/**
 * Outstanding advance carried into `month` for an employee.
 * = all advances issued in earlier months - all advances already recovered.
 * Never lost, never duplicated: each month recovers from this running balance.
 */
export function getCarryForward(
  employeeId: number | string,
  month: string,
  batches: PayrollBatch[],
) {
  let balance = 0;
  batches
    .filter((b) => b.month < month)
    .forEach((b) => {
      b.lines
        .filter((l) => String(l.employee_id) === String(employeeId))
        .forEach((l) => {
          balance += toNum(l.new_advance);
          balance -= toNum(l.prev_advance);
        });
    });
  return Math.max(0, Math.round(balance * 1000) / 1000);
}

/** Advance still outstanding after every recorded month. */
export function outstandingAdvance(employeeId: number | string, batches: PayrollBatch[]) {
  let balance = 0;
  batches.forEach((b) => {
    b.lines
      .filter((l) => String(l.employee_id) === String(employeeId))
      .forEach((l) => {
        balance += toNum(l.new_advance);
        balance -= toNum(l.prev_advance);
      });
  });
  return Math.max(0, Math.round(balance * 1000) / 1000);
}

export interface HistoryRow extends PayrollLine {
  month: string;
  site: string;
  batchForeman: string;
  batchId: string;
}

/** Flattened month-by-month rows for one employee (or all when empty). */
export function employeeRows(batches: PayrollBatch[], employeeId?: number | string): HistoryRow[] {
  const out: HistoryRow[] = [];
  batches.forEach((b) => {
    b.lines.forEach((l) => {
      if (!l.employee_id) return;
      if (employeeId && String(l.employee_id) !== String(employeeId)) return;
      out.push({
        ...l,
        month: b.month,
        site: b.site,
        batchForeman: b.foreman,
        batchId: b.id,
      });
    });
  });
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export function rowTotals(rows: HistoryRow[]) {
  const sum = (f: (r: HistoryRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    hours: sum((r) => toNum(r.hours)),
    gross: sum(lineGross),
    food: sum((r) => toNum(r.food_deduction)),
    prevAdv: sum((r) => toNum(r.prev_advance)),
    newAdv: sum((r) => toNum(r.new_advance)),
    otherDeduct: sum((r) => toNum(r.other_deduction)),
    net: sum((r) => toNum(r.net_salary)),
    paid: sum((r) => toNum(r.paid)),
    balance: sum(lineBalance),
  };
}

/** Employees already used in another batch for the same month (block duplicates). */
export function lockedEmployeeIds(
  batches: PayrollBatch[],
  month: string,
  currentBatchId: string | null,
) {
  const set = new Set<string>();
  batches
    .filter((b) => b.month === month && b.id !== currentBatchId)
    .forEach((b) => b.lines.forEach((l) => l.employee_id && set.add(String(l.employee_id))));
  return set;
}

/* ---------------- Advance management ---------------- */

export interface AdvanceTx {
  id: string;
  employee_id: number;
  date: string;
  amount: number;
  reason: string;
  payment_method: string;
  notes: string;
}

export const PAYMENT_METHODS = ["Cash", "Bank"] as const;

export const ADVANCE_REASONS = [
  "Personal",
  "Medical",
  "Family support",
  "Travel / ticket",
  "Emergency",
  "Other",
];

export function txMonth(date: string) {
  return (date || "").slice(0, 7);
}

/** Advances issued to an employee through the Advance Management module. */
export function advancesIssued(
  employeeId: number | string,
  advances: AdvanceTx[],
  beforeMonth?: string,
) {
  return advances
    .filter((a) => String(a.employee_id) === String(employeeId))
    .filter((a) => (beforeMonth ? txMonth(a.date) < beforeMonth : true))
    .reduce((s, a) => s + toNum(a.amount), 0);
}

/** Advance recovered through payroll (prev_advance column). */
export function advancesRecovered(
  employeeId: number | string,
  batches: PayrollBatch[],
  beforeMonth?: string,
) {
  let total = 0;
  batches
    .filter((b) => (beforeMonth ? b.month < beforeMonth : true))
    .forEach((b) =>
      b.lines
        .filter((l) => String(l.employee_id) === String(employeeId))
        .forEach((l) => {
          total += toNum(l.prev_advance);
        }),
    );
  return total;
}

/** Advances added directly on a payroll line (new_advance column). */
function payrollAdvancesIssued(
  employeeId: number | string,
  batches: PayrollBatch[],
  beforeMonth?: string,
) {
  let total = 0;
  batches
    .filter((b) => (beforeMonth ? b.month < beforeMonth : true))
    .forEach((b) =>
      b.lines
        .filter((l) => String(l.employee_id) === String(employeeId))
        .forEach((l) => {
          total += toNum(l.new_advance);
        }),
    );
  return total;
}

/**
 * Outstanding advance carried INTO `month`, combining advance transactions and
 * payroll-line advances, minus everything already recovered in earlier months.
 */
export function advanceCarryForward(
  employeeId: number | string,
  month: string,
  batches: PayrollBatch[],
  advances: AdvanceTx[] = [],
) {
  const bal =
    advancesIssued(employeeId, advances, month) +
    payrollAdvancesIssued(employeeId, batches, month) -
    advancesRecovered(employeeId, batches, month);
  return Math.max(0, Math.round(bal * 1000) / 1000);
}

/** Total advance still outstanding across all months. */
export function advanceOutstanding(
  employeeId: number | string,
  batches: PayrollBatch[],
  advances: AdvanceTx[] = [],
) {
  const bal =
    advancesIssued(employeeId, advances) +
    payrollAdvancesIssued(employeeId, batches) -
    advancesRecovered(employeeId, batches);
  return Math.max(0, Math.round(bal * 1000) / 1000);
}
