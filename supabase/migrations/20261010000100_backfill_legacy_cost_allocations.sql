-- Make previously saved payroll visible in Cost Allocation using its recorded batch site.
-- These rows are explicitly marked estimated because historic attendance may be unavailable.

ALTER TABLE public.payroll_site_allocations
  DISABLE TRIGGER payroll_site_allocations_lifecycle_trg;

INSERT INTO public.payroll_site_allocations (
  payroll_line_id,
  employee_id,
  month,
  site,
  foreman,
  regular_hours,
  overtime_hours,
  allocated_regular_pay,
  allocated_overtime_pay,
  allocated_allowances,
  allocated_gross_cost,
  allocation_basis,
  calculation_version
)
SELECT
  line.id,
  line.employee_id,
  line.month,
  COALESCE(NULLIF(btrim(batch.site), ''), 'Unassigned'),
  COALESCE(NULLIF(btrim(line.foreman), ''), NULLIF(btrim(batch.foreman), ''), 'Unassigned'),
  hours.regular_hours,
  hours.overtime_hours,
  pay.regular_pay,
  pay.overtime_pay,
  pay.allowances,
  derived.gross_cost,
  'LEGACY_ESTIMATED',
  line.calculation_version
FROM public.payroll_lines AS line
JOIN public.payroll_batches AS batch ON batch.id = line.batch_id
CROSS JOIN LATERAL (
  SELECT
    COALESCE(line.regular_hours, GREATEST(line.hours - COALESCE(line.overtime_hours, 0), 0), 0) AS regular_hours,
    COALESCE(line.overtime_hours, 0) AS overtime_hours
) AS hours
CROSS JOIN LATERAL (
  SELECT
    COALESCE(line.regular_pay, hours.regular_hours * COALESCE(line.rate, 0), 0) AS regular_pay,
    COALESCE(line.overtime_pay, hours.overtime_hours * COALESCE(line.rate, 0), 0) AS overtime_pay,
    COALESCE(line.allowances, 0) AS allowances
) AS pay
CROSS JOIN LATERAL (
  SELECT COALESCE(line.gross_pay, pay.regular_pay + pay.overtime_pay + pay.allowances, 0) AS gross_cost
) AS derived
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payroll_site_allocations AS allocation
  WHERE allocation.payroll_line_id = line.id
);

ALTER TABLE public.payroll_site_allocations
  ENABLE TRIGGER payroll_site_allocations_lifecycle_trg;

NOTIFY pgrst, 'reload schema';
