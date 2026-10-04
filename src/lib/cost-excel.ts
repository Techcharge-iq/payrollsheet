import { fmt, monthLabel } from "./payroll";
import type { AllocationRow } from "./cost-allocation";
import { costReportFilename, type CostReportMeta } from "./cost-pdf";

function escapeCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function downloadCostExcel(rows: AllocationRow[], meta: CostReportMeta) {
  if (!rows.length) return;
  const headers = [
    "Emp ID",
    "Employee",
    "Trade",
    "Site",
    "Foreman",
    "Month",
    "Regular hours",
    "Overtime hours",
    "Allocated regular pay",
    "Allocated overtime pay",
    "Allocated allowances",
    "Allocated gross labour cost",
    "Allocation basis",
  ];
  const lines = rows.map((r) =>
    [
      r.employeeId,
      r.name,
      r.trade,
      r.site,
      r.foreman,
      monthLabel(r.month),
      fmt(r.regularHours),
      fmt(r.overtimeHours),
      fmt(r.allocatedRegularPay),
      fmt(r.allocatedOvertimePay),
      fmt(r.allocatedAllowances),
      fmt(r.grossCost),
      r.allocationBasis,
    ]
      .map(escapeCsv)
      .join(","),
  );
  const csv = [headers.map(escapeCsv).join(","), ...lines].join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = costReportFilename(meta).replace(/\.pdf$/, ".csv");
  anchor.click();
  URL.revokeObjectURL(url);
}
