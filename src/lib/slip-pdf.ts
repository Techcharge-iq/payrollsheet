import { jsPDF } from "jspdf";
import JSZip from "jszip";
import {
  fmt,
  lineBalance,
  lineGross,
  monthLabel,
  toNum,
  type Employee,
  type HistoryRow,
} from "./payroll";

type RGB = [number, number, number];
type HeaderImage = string;

const INK: RGB = [24, 29, 35];
const MUTED: RGB = [91, 100, 110];
const BORDER: RGB = [190, 197, 203];
const GREEN: RGB = [54, 157, 117];
const RED: RGB = [204, 69, 70];
const BLUE: RGB = [52, 111, 170];

export interface SlipInput {
  employee: Employee;
  month: string;
  row: HistoryRow;
  carriedForward: number;
  outstandingAdvance: number;
}

function money(value: number) {
  return `${fmt(value)} OMR`;
}

function fitFontSize(doc: jsPDF, text: string, maxWidth: number, preferred: number, minimum = 6) {
  let size = preferred;
  while (size > minimum) {
    doc.setFontSize(size);
    if (doc.getTextWidth(text) <= maxWidth) return size;
    size -= 0.25;
  }
  doc.setFontSize(minimum);
  return minimum;
}

let headerImagePromise: Promise<HeaderImage> | undefined;

function loadHeaderImage() {
  if (!headerImagePromise) {
    headerImagePromise = fetch("/Salary Header.png")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load salary slip header (${response.status}).`);
        }
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise<HeaderImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result !== "string") {
                reject(new Error("Salary slip header could not be read."));
                return;
              }
              resolve(reader.result);
            };
            reader.onerror = () => reject(new Error("Salary slip header could not be read."));
            reader.readAsDataURL(blob);
          }),
      );
  }
  return headerImagePromise;
}

function drawLabelValue(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  const cellRight = x + width;
  const labelMaxWidth = width * 0.46;
  const valueMaxWidth = width * 0.48;
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, label, labelMaxWidth, 8.5, 6.25);
  doc.setTextColor(...INK);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  fitFontSize(doc, value || "—", valueMaxWidth, 9, 6.25);
  doc.text(value || "—", cellRight, y, { align: "right" });
}

function drawCard(
  doc: jsPDF,
  title: string,
  color: RGB,
  x: number,
  y: number,
  width: number,
  rows: Array<{ label: string; value: string; emphasis?: boolean }>,
  total: { label: string; value: string },
) {
  const height = 77;
  const headerHeight = 12;
  const panelInset = 3.5;
  const columnGap = 3.5;
  const valueBoxWidth = Math.min(28.5, Math.max(27.5, width * 0.52));
  const valueBoxHeight = 7.6;
  const rowStart = y + 23.5;
  const rowStep = 13.5;
  const totalRowY = y + height - 5.8;

  doc.setFillColor(249, 250, 251);
  doc.setDrawColor(225, 229, 233);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  doc.setFillColor(...color);
  doc.roundedRect(x, y, width, headerHeight, 2, 2, "F");
  doc.rect(x, y + 7, width, 5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, title, width - 8, 11, 8);
  doc.text(title, x + width / 2, y + 8.1, { align: "center" });

  const drawValueBox = (label: string, value: string, rowY: number, emphasis = false) => {
    const innerLeft = x + panelInset;
    const valueRight = x + width - panelInset;
    const labelWidth = valueRight - innerLeft - valueBoxWidth - columnGap;
    const valueLeft = valueRight - valueBoxWidth;

    doc.setFont("helvetica", emphasis ? "bold" : "bold");
    let labelFontSize = 8.25;
    let labelLines: string[] = [];
    while (labelFontSize > 6.25) {
      doc.setFontSize(labelFontSize);
      labelLines = doc.splitTextToSize(label, labelWidth);
      if (labelLines.length <= 2) break;
      labelFontSize -= 0.25;
    }
    doc.setFontSize(Math.max(labelFontSize, 6.25));
    labelLines = doc.splitTextToSize(label, labelWidth);
    doc.setTextColor(...INK);
    const labelLineHeight = 3.1;
    const firstLabelLineY = rowY - ((labelLines.length - 1) * labelLineHeight) / 2;
    doc.text(labelLines, innerLeft, firstLabelLineY, { lineHeightFactor: 1 });

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...color);
    doc.setLineWidth(0.35);
    doc.roundedRect(valueLeft, rowY - 5.35, valueBoxWidth, valueBoxHeight, 1.35, 1.35, "FD");
    doc.setFont("helvetica", emphasis ? "bold" : "normal");
    fitFontSize(doc, value || "—", valueBoxWidth - 5, emphasis ? 8.25 : 8, 6.25);
    doc.setTextColor(...INK);
    doc.text(value || "—", valueRight - 2.25, rowY, { align: "right" });
  };

  rows.forEach(({ label, value, emphasis }, index) => {
    drawValueBox(label, value, rowStart + index * rowStep, emphasis);
  });

  doc.setFillColor(...color);
  doc.roundedRect(x + 2.5, y + height - 11.5, width - 5, 9, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  const totalLabelWidth = width - panelInset * 2 - valueBoxWidth - columnGap;
  fitFontSize(doc, total.label, totalLabelWidth, 8.5, 6.25);
  doc.text(total.label, x + panelInset, totalRowY);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...color);
  doc.roundedRect(
    x + width - panelInset - valueBoxWidth,
    y + height - 10.8,
    valueBoxWidth,
    valueBoxHeight,
    1.35,
    1.35,
    "FD",
  );
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, total.value, valueBoxWidth - 5, 8.25, 6.25);
  doc.text(total.value, x + width - panelInset - 2.25, totalRowY, { align: "right" });
}

function drawSlip(doc: jsPDF, slip: SlipInput, headerImage: HeaderImage) {
  const { employee: e, month, row } = slip;
  const pageWidth = 210;
  const left = 15;
  const contentWidth = 180;
  const gross = lineGross(row);
  const food = toNum(row.food_deduction);
  const advanceRecovered = toNum(row.prev_advance);
  const other = toNum(row.other_deduction);
  const totalDeductions = food + advanceRecovered + other;
  const net = toNum(row.net_salary);
  const balance = lineBalance(row);
  const status = toNum(row.paid) >= net ? "PAID" : toNum(row.paid) > 0 ? "PARTIAL" : "PENDING";

  doc.setFillColor(252, 253, 254);
  doc.rect(0, 0, pageWidth, 297, "F");

  doc.addImage(headerImage, "PNG", left, 8, contentWidth, 31);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(monthLabel(month).toUpperCase(), pageWidth / 2, 44, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("STAFF DETAILS:", left, 57);

  const tableY = 61;
  const rowHeight = 10;
  const columns = [left, 53, 105, 143, left + contentWidth];
  const staffRows: Array<[string, string, string, string]> = [
    ["NAME EMPLOYEE:", e.name, "TRADE:", e.trade],
    ["EMP ID NO:", e.id_number || "—", "SALARY MONTH:", monthLabel(month)],
    ["SITE:", row.site || "—", "FOREMAN:", row.foreman || row.batchForeman || "—"],
  ];
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.25);
  staffRows.forEach((values, index) => {
    const y = tableY + index * rowHeight;
    doc.rect(left, y, contentWidth, rowHeight);
    doc.line(columns[1]!, y, columns[1]!, y + rowHeight);
    doc.line(columns[2]!, y, columns[2]!, y + rowHeight);
    doc.line(columns[3]!, y, columns[3]!, y + rowHeight);
    const cells: Array<[number, string, boolean]> = [
      [0, values[0], true],
      [1, values[1], false],
      [2, values[2], true],
      [3, values[3], false],
    ];
    cells.forEach(([col, text, isLabel]) => {
      const x0 = columns[col]! + 3;
      const w = columns[col + 1]! - columns[col]! - 6;
      doc.setFont("helvetica", isLabel ? "bold" : "normal");
      fitFontSize(doc, text || "—", w, isLabel ? 8.5 : 9, 6.25);
      doc.setTextColor(...INK);
      doc.text(text || "—", x0, y + 6.3);
    });
  });

  const cardY = 99;
  const gap = 6;
  const cardWidth = (contentWidth - gap * 2) / 3;
  drawCard(
    doc,
    "INCOME",
    GREEN,
    left,
    cardY,
    cardWidth,
    [
      { label: "SALARY BASIC / HR", value: money(toNum(row.rate)) },
      { label: "TOTAL WORK HOURS", value: `${fmt(toNum(row.hours))} hrs` },
    ],
    { label: "INCOME TOTAL", value: money(gross) },
  );
  drawCard(
    doc,
    "DEDUCTION",
    RED,
    left + cardWidth + gap,
    cardY,
    cardWidth,
    [
      { label: "FOOD DEDUCT", value: money(food) },
      { label: "ADVANCE RECOVERED", value: money(advanceRecovered) },
      { label: "OTHER DEDUCT", value: money(other) },
    ],
    { label: "TOTAL DEDUCT", value: money(totalDeductions) },
  );
  drawCard(
    doc,
    "SUMMARY",
    BLUE,
    left + (cardWidth + gap) * 2,
    cardY,
    cardWidth,
    [
      { label: "TOTAL INCOME", value: money(gross) },
      { label: "TOTAL DEDUCT", value: money(totalDeductions) },
      { label: "NET SALARY", value: money(net), emphasis: true },
      { label: "OUTSTANDING", value: money(slip.outstandingAdvance) },
    ],
    { label: "STATUS", value: status },
  );

  const detailsY = 190;
  doc.setFillColor(245, 247, 249);
  doc.roundedRect(left, detailsY, contentWidth, 25, 2, 2, "F");
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PAYMENT DETAILS", left + 5, detailsY + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`Paid this month: ${money(toNum(row.paid))}`, left + 5, detailsY + 15);
  doc.text(`Remaining salary balance: ${money(balance)}`, left + 95, detailsY + 15);
  doc.text(`Advance brought forward: ${money(slip.carriedForward)}`, left + 5, detailsY + 21);
  doc.text(`New advance issued: ${money(toNum(row.new_advance))}`, left + 95, detailsY + 21);

  doc.setDrawColor(150, 156, 163);
  doc.setLineWidth(0.35);
  doc.line(left, 247, left + 56, 247);
  doc.line(left + 124, 247, left + contentWidth, 247);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("Authorised Signature", left, 253);
  doc.text("Employee Signature", left + 124, 253);
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "This salary slip is computer generated and does not require a company stamp.",
    pageWidth / 2,
    276,
    {
      align: "center",
    },
  );
}

export function sanitizeFilename(value: string) {
  const sanitized = value
    .replace(/[/\\:*?"<>|]/g, "-")
    .trim()
    .replace(/[. ]+$/g, "");
  return sanitized || "salary-slip";
}

function slipFilename(slip: SlipInput) {
  return `${sanitizeFilename(`${slip.employee.name} - ${slip.employee.trade}`)}.pdf`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function generateSalarySlipPDF(slip: SlipInput, headerImage?: HeaderImage) {
  const resolvedHeaderImage = headerImage ?? (await loadHeaderImage());
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawSlip(doc, slip, resolvedHeaderImage);
  return doc.output("blob");
}

interface DownloadSlipsOptions {
  onProgress?: (completed: number, total: number) => void;
}

export async function downloadSlips(slips: SlipInput[], options: DownloadSlipsOptions = {}) {
  if (!slips.length) return;
  const headerImage = await loadHeaderImage();

  if (slips.length === 1) {
    const slip = slips[0]!;
    const pdf = await generateSalarySlipPDF(slip, headerImage);
    downloadBlob(pdf, slipFilename(slip));
    return;
  }

  const zip = new JSZip();
  const filenames = new Set<string>();
  for (const [index, slip] of slips.entries()) {
    let filename = slipFilename(slip);
    const extension = ".pdf";
    const base = filename.slice(0, -extension.length);
    let duplicateNumber = 2;
    while (filenames.has(filename)) {
      filename = `${base} (${duplicateNumber})${extension}`;
      duplicateNumber += 1;
    }
    filenames.add(filename);

    try {
      const pdf = await generateSalarySlipPDF(slip, headerImage);
      zip.file(filename, pdf);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown PDF generation error.";
      throw new Error(`Unable to generate salary slip for ${slip.employee.name}: ${reason}`, {
        cause: error,
      });
    }
    options.onProgress?.(index + 1, slips.length);
  }

  const archive = await zip.generateAsync({ type: "blob" });
  downloadBlob(archive, `Salary Slips - ${sanitizeFilename(monthLabel(slips[0]!.month))}.zip`);
}
