export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TableShape<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Employee = {
  id: number;
  name: string;
  trade: string;
  id_number: string;
  hourly_rate: number;
  status: string;
  created_at: string;
};
type PayrollBatchRow = {
  id: string;
  month: string;
  site: string;
  foreman: string;
  project_id: string | null;
  foreman_user_id: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  created_at: string;
};
type PayrollLineRow = {
  id: string;
  batch_id: string;
  employee_id: number;
  month: string;
  foreman: string;
  foreman_user_id: string | null;
  hours: number;
  rate: number;
  food_deduction: number;
  prev_advance: number;
  new_advance: number;
  other_deduction: number;
  net_salary: number;
  paid: number;
  calculation_version: string | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  regular_pay: number | null;
  overtime_pay: number | null;
  allowances: number | null;
  gross_pay: number | null;
  deductions: number | null;
  advance_recovery: number | null;
  net_pay: number | null;
  rate_segments: Json | null;
  overtime_multiplier: number | null;
  created_at: string;
};
type Timesheet = {
  id: string;
  employee_id: number;
  site: string;
  foreman: string;
  project_id: string | null;
  foreman_user_id: string | null;
  work_date: string;
  in_time: string | null;
  out_time: string | null;
  break_hours: number;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  status: string;
  remarks: string | null;
  created_at: string;
};
type SiteAllocation = {
  id: string;
  payroll_line_id: string;
  employee_id: number;
  month: string;
  site: string;
  project_id: string | null;
  foreman: string;
  regular_hours: number;
  overtime_hours: number;
  allocated_regular_pay: number;
  allocated_overtime_pay: number;
  allocated_allowances: number;
  allocated_gross_cost: number;
  allocation_basis: string;
  calculation_version: string | null;
  created_at: string;
};
type AdvanceTransaction = {
  id: string;
  employee_id: number;
  date: string | null;
  amount: number;
  reason: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
};
type UserRole = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};
type AuditLog = {
  id: string;
  table_name: string;
  record_id: string | null;
  operation: string;
  actor_id: string | null;
  actor_email: string | null;
  old_data: Json | null;
  new_data: Json | null;
  changed_at: string;
};
type SalaryHistory = {
  id: string;
  employee_id: number;
  hourly_rate: number;
  effective_on: string;
  created_by: string | null;
  created_at: string;
};
type SiteAssignment = {
  id: string;
  employee_id: number;
  site: string;
  foreman: string;
  project_id: string | null;
  foreman_user_id: string | null;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
};
type TransferRequest = {
  id: string;
  employee_id: number;
  from_site: string | null;
  to_site: string;
  to_foreman: string;
  from_project_id: string | null;
  to_project_id: string | null;
  to_foreman_user_id: string | null;
  effective_on: string;
  reason: string;
  status: string;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};
type Project = {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  notes: string | null;
  active: boolean;
  foreman_user_id: string | null;
  created_at: string;
  updated_at: string;
};
type ManagerProjectAssignment = {
  id: string;
  manager_user_id: string;
  project_id: string;
  assigned_by: string | null;
  created_at: string;
};
type LeaveType = {
  id: string;
  name: string;
  annual_entitlement_days: number | null;
  payroll_treatment: string;
  active: boolean;
  created_at: string;
};
type LeaveRequest = {
  id: string;
  employee_id: number;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  requested_days: number;
  reason: string;
  status: string;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      employees: TableShape<Employee, "name">;
      payroll_batches: TableShape<PayrollBatchRow, "month">;
      payroll_lines: TableShape<PayrollLineRow, "batch_id" | "employee_id" | "month">;
      timesheets: TableShape<Timesheet, "employee_id" | "site" | "foreman" | "work_date">;
      payroll_site_allocations: TableShape<
        SiteAllocation,
        "payroll_line_id" | "employee_id" | "month" | "site" | "foreman" | "allocation_basis"
      >;
      advance_transactions: TableShape<AdvanceTransaction, "employee_id" | "date" | "amount">;
      users: TableShape<UserRole, "user_id" | "role">;
      projects: TableShape<Project, "name">;
      manager_project_assignments: TableShape<
        ManagerProjectAssignment,
        "manager_user_id" | "project_id"
      >;
      audit_logs: TableShape<AuditLog, "table_name" | "operation">;
      employee_salary_history: TableShape<
        SalaryHistory,
        "employee_id" | "hourly_rate" | "effective_on"
      >;
      employee_site_assignments: TableShape<
        SiteAssignment,
        "employee_id" | "site" | "effective_from"
      >;
      employee_transfer_requests: TableShape<
        TransferRequest,
        "employee_id" | "to_site" | "effective_on"
      >;
      leave_types: TableShape<LeaveType, "name">;
      leave_requests: TableShape<
        LeaveRequest,
        "employee_id" | "leave_type_id" | "start_date" | "end_date" | "requested_days"
      >;
      payroll_settings: TableShape<
        {
          singleton: boolean;
          overtime_multiplier: number | null;
          updated_at: string;
          updated_by: string | null;
        },
        "singleton"
      >;
    };
    Views: Record<string, never>;
    Functions: {
      payroll_advance_balances_before: {
        Args: { target_month: string };
        Returns: Array<{ employee_id: number; balance: number }>;
      };
      has_payroll_role: { Args: { required_roles: string[] }; Returns: boolean };
      can_access_project: { Args: { target_project_id: string }; Returns: boolean };
      can_access_employee: { Args: { target_employee_id: number }; Returns: boolean };
      can_access_employee_project: {
        Args: { target_employee_id: number; target_project_id: string };
        Returns: boolean;
      };
      can_access_payroll_batch: { Args: { target_batch_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export const Constants = { public: { Enums: {} } } as const;
