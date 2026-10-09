export interface WpsBatchLine {
  [key: string]: string | number | null | undefined;
}

export const WPS_FIELD_OPTIONS = [
  ["employee_id", "Employee database ID"],
  ["employee_name", "Employee name"],
  ["id_number", "Employee ID number"],
  ["month", "Payroll month"],
  ["regular_hours", "Regular hours"],
  ["overtime_hours", "Overtime hours"],
  ["regular_pay", "Regular pay"],
  ["overtime_pay", "Overtime pay"],
  ["allowances", "Allowances"],
  ["gross_pay", "Gross pay"],
  ["deductions", "Deductions"],
  ["advance_recovery", "Advance recovery"],
  ["net_pay", "Net pay"],
  ["paid", "Amount already paid"],
] as const;

export function parseCsvHeader(csvText: string): string[] {
  const firstLine = csvText.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const headers: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index]!;
    if (char === '"') {
      if (quoted && firstLine[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      headers.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  headers.push(value.trim());
  if (!headers.length || headers.some((header) => !header)) {
    throw new Error("The bank template must have a non-empty CSV header row.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error(
      "The bank template has duplicate column names; use a template with unique headers.",
    );
  }
  return headers;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function createWpsCsv(
  headers: string[],
  mapping: Record<string, string>,
  lines: WpsBatchLine[],
) {
  if (!headers.length || !lines.length)
    throw new Error("Choose a payroll batch and a bank template first.");
  const missing = headers.filter((header) => !mapping[header]);
  if (missing.length)
    throw new Error(`Map every template column before export: ${missing.join(", ")}`);
  return [
    headers.map(csvCell).join(","),
    ...lines.map((line) => headers.map((header) => csvCell(line[mapping[header]!])).join(",")),
  ].join("\r\n");
}

export function wpsFilename(
  crNumber: string,
  bankCode: string,
  preparedOn: string,
  sequence: number,
) {
  const cr = crNumber.trim();
  const bank = bankCode.trim().toUpperCase();
  if (!/^[A-Za-z0-9]{1,17}$/.test(cr))
    throw new Error("Commercial Registration number must be 1–17 letters or digits.");
  if (!/^[A-Z0-9]{1,4}$/.test(bank))
    throw new Error("Bank code must be 1–4 letters or digits, as assigned by the bank.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preparedOn)) throw new Error("Choose a valid preparation date.");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999)
    throw new Error("Sequence must be from 001 to 999.");
  return `SIF_${cr}_${bank}_${preparedOn.replaceAll("-", "")}_${String(sequence).padStart(3, "0")}.csv`;
}
