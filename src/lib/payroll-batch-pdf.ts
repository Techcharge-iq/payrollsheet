import { jsPDF } from "jspdf";
import { fmt, lineGross, monthLabel, toNum, type Employee, type PayrollBatch } from "./payroll";

const NAVY: [number, number, number] = [32, 40, 50];
const TEAL: [number, number, number] = [8, 126, 139];
const WARN: [number, number, number] = [181, 121, 0];
const COMPANY = "Site Payroll Manager";

function safeName(value: string) {
  return value.replace(/[/\\:*?"<>|]/g, "-").trim().replace(/\s+/g, "-").toLowerCase();
}

export function payrollBatchFilename(batch: PayrollBatch) {
  return `payroll-${safeName(batch.site || "batch")}-${batch.month}.pdf`;
}

export function payrollBatchBlob(batch: PayrollBatch, employees: Employee[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const left = 10;
  const width = 277;
  const columns: Array<[string, number, "left" | "right"]> = [
    ["Emp ID", 22, "left"], ["Employee", 38, "left"], ["Foreman", 30, "left"],
    ["Hours", 18, "right"], ["Rate", 18, "right"], ["Gross", 23, "right"],
    ["Food", 19, "right"], ["Prev adv.", 22, "right"], ["New adv.", 22, "right"],
    ["Other", 19, "right"], ["Net", 23, "right"], ["Paid", 23, "right"],
  ];
  const drawHeader = (y: number) => {
    doc.setFillColor(...NAVY);
    doc.rect(left, y - 5, width, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    let x = left + 2;
    columns.forEach(([label, columnWidth, align]) => {
      doc.text(label, align === "right" ? x + columnWidth - 3 : x, y, { align });
      x += columnWidth;
    });
  };

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, 297, 25, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(COMPANY.toUpperCase(), left, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Payroll report | ${monthLabel(batch.month)} | Site: ${batch.site || "—"} | Foreman: ${batch.foreman || "—"}`, left, 18);

  let y = 34;
  drawHeader(y);
  y += 7;
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(7.5);
  batch.lines.forEach((line, index) => {
    if (y > 190) {
      doc.addPage();
      y = 18;
      drawHeader(y);
      y += 7;
      doc.setTextColor(40, 40, 40);
    }
    if (index % 2 === 0) {
      doc.setFillColor(245, 247, 248);
      doc.rect(left, y - 4.5, width, 6.5, "F");
    }
    const employee = employees.find((item) => String(item.id) === String(line.employee_id));
    const values = [
      employee?.id_number || String(employee?.id ?? "Not Assigned"), employee?.name || "Unknown employee",
      line.foreman || batch.foreman || "—", fmt(toNum(line.hours)), fmt(toNum(line.rate)),
      fmt(lineGross(line)), fmt(toNum(line.food_deduction)), fmt(toNum(line.prev_advance)),
      fmt(toNum(line.new_advance)), fmt(toNum(line.other_deduction)), fmt(toNum(line.net_salary)), fmt(toNum(line.paid)),
    ];
    let x = left + 2;
    values.forEach((value, columnIndex) => {
      const [, columnWidth, align] = columns[columnIndex]!;
      if (columnIndex === 8 && toNum(line.new_advance) > 0) {
        doc.setFillColor(255, 244, 214);
        doc.roundedRect(x - 1, y - 4.2, columnWidth - 2, 5.5, 1, 1, "F");
        doc.setTextColor(...WARN);
        doc.setFont("helvetica", "bold");
      }
      const text = align === "left" ? (doc.splitTextToSize(String(value), columnWidth - 4)[0] ?? "") : String(value);
      doc.text(text, align === "right" ? x + columnWidth - 3 : x, y, { align });
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "normal");
      x += columnWidth;
    });
    y += 6.5;
  });

  const totals = batch.lines.reduce((sum, line) => ({
    gross: sum.gross + lineGross(line), net: sum.net + toNum(line.net_salary),
    paid: sum.paid + toNum(line.paid), advances: sum.advances + toNum(line.new_advance),
  }), { gross: 0, net: 0, paid: 0, advances: 0 });
  if (y > 180) { doc.addPage(); y = 20; }
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.7);
  doc.line(left, y + 1, left + width, y + 1);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Employees: ${batch.lines.length}   Gross: ${fmt(totals.gross)} OMR   Net: ${fmt(totals.net)} OMR   Paid: ${fmt(totals.paid)} OMR   Balance: ${fmt(totals.net - totals.paid)} OMR   New advances: ${fmt(totals.advances)} OMR`, left, y + 8);
  return doc.output("blob") as Blob;
}

export function downloadPayrollBatch(batch: PayrollBatch, employees: Employee[]) {
  const url = URL.createObjectURL(payrollBatchBlob(batch, employees));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = payrollBatchFilename(batch);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}