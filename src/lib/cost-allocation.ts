import type { Employee } from "./payroll";
import type { PayrollSiteAllocation } from "./payroll-data";

export interface AllocationRow {
  key: string;
  employeeId: string;
  name: string;
  trade: string;
  site: string;
  foreman: string;
  month: string;
  regularHours: number;
  overtimeHours: number;
  allocatedRegularPay: number;
  allocatedOvertimePay: number;
  allocatedAllowances: number;
  grossCost: number;
  allocationBasis: string;
}

export function buildAllocationRows(
  allocations: PayrollSiteAllocation[],
  employees: Employee[],
): AllocationRow[] {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  return allocations.map((allocation) => {
    const employee = byId.get(allocation.employee_id);
    return {
      key: allocation.id,
      employeeId: employee?.id_number?.trim() || String(allocation.employee_id),
      name: employee?.name ?? `Employee #${allocation.employee_id}`,
      trade: employee?.trade ?? "—",
      site: allocation.site,
      foreman: allocation.foreman,
      month: allocation.month,
      regularHours: Number(allocation.regular_hours),
      overtimeHours: Number(allocation.overtime_hours),
      allocatedRegularPay: Number(allocation.allocated_regular_pay),
      allocatedOvertimePay: Number(allocation.allocated_overtime_pay),
      allocatedAllowances: Number(allocation.allocated_allowances),
      grossCost: Number(allocation.allocated_gross_cost),
      allocationBasis: allocation.allocation_basis,
    };
  });
}

export function allocationTotals(rows: AllocationRow[]) {
  const sum = (field: (row: AllocationRow) => number) =>
    rows.reduce((total, row) => total + field(row), 0);
  return {
    staff: new Set(rows.map((row) => row.employeeId)).size,
    regularHours: sum((row) => row.regularHours),
    overtimeHours: sum((row) => row.overtimeHours),
    regularPay: sum((row) => row.allocatedRegularPay),
    overtimePay: sum((row) => row.allocatedOvertimePay),
    allowances: sum((row) => row.allocatedAllowances),
    grossCost: sum((row) => row.grossCost),
  };
}
