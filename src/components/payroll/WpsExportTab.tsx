import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { lineGross, type Employee, type PayrollBatch } from "@/lib/payroll";
import { useBatches } from "@/lib/payroll-data";
import {
  createWpsCsv,
  parseCsvHeader,
  WPS_FIELD_OPTIONS,
  wpsFilename,
  type WpsBatchLine,
} from "@/lib/wps-export";
import { btnGold, btnOutline, card, input, select } from "./ui";

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function lineValue(
  line: PayrollBatch["lines"][number],
  employee: Employee | undefined,
  batch: PayrollBatch,
): WpsBatchLine {
  return {
    employee_id: line.employee_id,
    employee_name: employee?.name ?? "",
    id_number: employee?.id_number ?? "",
    month: batch.month,
    regular_hours: line.regular_hours ?? line.hours,
    overtime_hours: line.overtime_hours ?? 0,
    regular_pay: line.regular_pay ?? 0,
    overtime_pay: line.overtime_pay ?? 0,
    allowances: line.allowances ?? 0,
    gross_pay: lineGross(line),
    deductions: line.deductions ?? Number(line.food_deduction) + Number(line.other_deduction),
    advance_recovery: line.advance_recovery ?? line.prev_advance,
    net_pay: line.net_pay ?? line.net_salary,
    paid: line.paid,
  };
}

export function WpsExportTab({ employees, role }: { employees: Employee[]; role: string }) {
  const batchesQuery = useBatches();
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const exportableBatches = useMemo(
    () => batches.filter((batch) => batch.status === "APPROVED"),
    [batches],
  );
  const [batchId, setBatchId] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [preparedOn, setPreparedOn] = useState(today);
  const [sequence, setSequence] = useState("1");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [basicMonthlyWage, setBasicMonthlyWage] = useState("");
  const [serviceDays, setServiceDays] = useState("");
  const [eosgReviewed, setEosgReviewed] = useState(false);
  const eosgEstimate =
    basicMonthlyWage &&
    serviceDays &&
    Number.isFinite(Number(basicMonthlyWage)) &&
    Number.isFinite(Number(serviceDays))
      ? Math.round(
          ((Number(basicMonthlyWage) * Number(serviceDays)) / 365 + Number.EPSILON) * 1000,
        ) / 1000
      : null;
  const batch = exportableBatches.find((item) => item.id === batchId);
  const rows = useMemo(
    () =>
      batch?.lines
        .filter((line) => line.employee_id !== "")
        .map((line) =>
          lineValue(
            line,
            employees.find((employee) => employee.id === Number(line.employee_id)),
            batch,
          ),
        ) ?? [],
    [batch, employees],
  );

  const download = () => {
    setMessage("");
    if (role !== "admin") {
      setMessage("Only administrators can prepare a WPS payment file.");
      return;
    }
    if (!batch || !headers.length) {
      setMessage(
        "Select an approved payroll batch and upload the current CSV template supplied by your bank.",
      );
      return;
    }
    if (!confirmed) {
      setMessage(
        "Review and confirm the bank template, required employee payment details, and payroll totals first.",
      );
      return;
    }
    try {
      const filename = wpsFilename(crNumber, bankCode, preparedOn, Number(sequence));
      const contents = createWpsCsv(headers, mapping, rows);
      const blob = new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(
        `Prepared ${filename}. Upload it through your bank’s approved WPS channel and record the payment result separately.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the CSV file.");
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <FileSpreadsheet className="text-gold-dark" />
        <div>
          <h2 className="font-display text-xl font-extrabold text-navy">
            WPS & payment operations
          </h2>
          <p className="text-sm text-muted-foreground">
            Prepare a reviewed CSV from a bank-provided template. No payment is sent from this app.
          </p>
        </div>
      </header>
      <div className="flex gap-3 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-navy">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p>
          The Ministry states the bank supplies the required SIF fields and bank-specific template.
          Map every column to verified payroll data; this exporter cannot populate bank account
          details that are not stored in the payroll records.
        </p>
      </div>
      {batchesQuery.error && (
        <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
          Could not load payroll batches: {batchesQuery.error.message}
        </p>
      )}
      <section className={card + " space-y-4 p-4"}>
        <h3 className="font-bold text-navy">1. Choose approved payroll and identify the file</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            className={select}
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
          >
            <option value="">Select approved payroll batch</option>
            {exportableBatches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.month} · {item.site} · {item.status}
              </option>
            ))}
          </select>
          <input
            className={input}
            value={crNumber}
            onChange={(event) => setCrNumber(event.target.value)}
            placeholder="Employer Commercial Registration"
          />
          <input
            className={input}
            value={bankCode}
            onChange={(event) => setBankCode(event.target.value)}
            placeholder="Bank assigned code"
          />
          <input
            className={input}
            type="date"
            value={preparedOn}
            onChange={(event) => setPreparedOn(event.target.value)}
          />
          <input
            className={input}
            type="number"
            min="1"
            max="999"
            value={sequence}
            onChange={(event) => setSequence(event.target.value)}
            aria-label="SIF file sequence"
          />
          <label className="text-sm">
            Bank SIF CSV template
            <input
              className="mt-1 block w-full text-sm"
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                setHeaders([]);
                setMapping({});
                setConfirmed(false);
                if (!file) return;
                try {
                  const parsed = parseCsvHeader(await file.text());
                  setHeaders(parsed);
                  setMapping(Object.fromEntries(parsed.map((header) => [header, ""])));
                } catch (error) {
                  setMessage(
                    error instanceof Error ? error.message : "Could not read the template.",
                  );
                }
              }}
            />
          </label>
        </div>
        {headers.length > 0 && (
          <>
            <h3 className="font-bold text-navy">2. Map every bank-template column</h3>
            <div className="max-h-72 space-y-2 overflow-auto rounded-lg border border-border p-3">
              {headers.map((header) => (
                <label
                  key={header}
                  className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_1fr]"
                >
                  <span>{header}</span>
                  <select
                    className={select}
                    value={mapping[header] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [header]: event.target.value }))
                    }
                  >
                    <option value="">Select a payroll field</option>
                    {WPS_FIELD_OPTIONS.map(([field, label]) => (
                      <option key={field} value={field}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    {headers.map((header) => (
                      <th className="p-2" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {headers.map((header) => (
                        <td className="p-2" key={header}>
                          {String(row[mapping[header] ?? ""] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-2 text-xs text-muted-foreground">
                Previewing {Math.min(rows.length, 5)} of {rows.length} payroll lines.
              </p>
            </div>
          </>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I reviewed the bank’s current template, column mapping, employee payment identifiers,
            and amounts for this batch.
          </span>
        </label>
        <button
          className={btnGold}
          disabled={role !== "admin" || !batch || !headers.length}
          onClick={download}
        >
          <Download size={15} /> Download WPS CSV
        </button>
        {role !== "admin" && (
          <p className="text-sm text-muted-foreground">
            Administrator access is required to create payment files.
          </p>
        )}
        {message && (
          <p className="text-sm text-navy" role="status">
            {message}
          </p>
        )}
      </section>
      <section className={card + " space-y-4 p-4"}>
        <h3 className="font-bold text-navy">EOSG scenario estimate · review only</h3>
        <p className="text-sm text-muted-foreground">
          This calculator is not configured for automatic eligibility or settlement. Enter reviewed
          source values for a scenario; it does not save, approve, or post a payment. For Oman
          Labour Law Article 61, the base is at least one last basic wage per year of service for
          workers not covered by the Social Protection Law; excluded periods, other benefit schemes,
          exceptions, and individual circumstances require review.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Last monthly basic wage (OMR)
            <input
              className={input + " mt-1"}
              type="number"
              min="0"
              step="0.001"
              value={basicMonthlyWage}
              onChange={(event) => setBasicMonthlyWage(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Eligible service days after review
            <input
              className={input + " mt-1"}
              type="number"
              min="0"
              step="1"
              value={serviceDays}
              onChange={(event) => setServiceDays(event.target.value)}
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={eosgReviewed}
            onChange={(event) => setEosgReviewed(event.target.checked)}
          />
          <span>
            I have verified the employee’s applicable scheme, eligibility, service dates, and
            excluded periods for this scenario.
          </span>
        </label>
        {eosgEstimate !== null && eosgReviewed && (
          <p className="rounded-lg border border-gold/40 bg-gold/10 p-3 font-semibold text-navy">
            Review estimate: OMR {eosgEstimate.toFixed(3)}{" "}
            <span className="block text-xs font-normal">
              Basic wage × reviewed service days ÷ 365. This scenario is not a final settlement
              figure.
            </span>
          </p>
        )}
        <a
          className="text-xs text-muted-foreground underline"
          href="https://mol.gov.om/Laborlaw?lid=6"
          target="_blank"
          rel="noreferrer"
        >
          Official Oman Labour Law text (Article 61)
        </a>
      </section>
      <p className="text-xs text-muted-foreground">
        The standard Oman filename pattern is SIF_CR_BANK_YYYYMMDD_NNN.csv. The bank code and SIF
        field layout must match instructions from the employer’s bank. The file is an instruction
        for separate bank-side upload and is not a payment confirmation.
      </p>
      <div className="flex justify-end">
        <button
          className={btnOutline}
          type="button"
          onClick={() => {
            setHeaders([]);
            setMapping({});
            setConfirmed(false);
          }}
        >
          Clear template and mapping
        </button>
      </div>
    </div>
  );
}
