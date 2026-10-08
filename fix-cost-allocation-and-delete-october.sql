-- Run this in your Supabase SQL Editor.
-- 1) Deletes ALL October 2026 payroll data so you can generate it fresh.
-- 2) Backfills Cost Allocation rows for August & September from the
--    existing payroll lines, so those months appear in Cost Allocation.

-- ============ 1) DELETE OCTOBER 2026 DATA ============

-- Allocation rows for October
DELETE FROM public.payroll_site_allocations
WHERE month = '2026-10';

-- Payroll lines for October
DELETE FROM public.payroll_lines
WHERE month = '2026-10';

-- Payroll batches for October
DELETE FROM public.payroll_batches
WHERE month = '2026-10';

-- October timesheets / attendance (if the table exists)
DELETE FROM public.timesheets
WHERE to_char(work_date, 'YYYY-MM') = '2026-10';


-- ============ 2) BACKFILL COST ALLOCATION FOR AUG & SEP ============
-- Creates one allocation row per payroll line that does not already have one.
-- Hours/pay are taken from the saved payroll line, so nothing is recalculated
-- or changed — the existing batches stay exactly as they are.

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
  pl.id,
  pl.employee_id,
  pl.month,
  COALESCE(pb.site, ''),
  COALESCE(NULLIF(pl.foreman, ''), pb.foreman, ''),
  COALESCE(pl.regular_hours, pl.hours, 0),
  COALESCE(pl.overtime_hours, 0),
  ROUND(COALESCE(pl.regular_hours, pl.hours, 0) * COALESCE(pl.rate, 0), 2),
  ROUND(COALESCE(pl.overtime_hours, 0) * COALESCE(pl.rate, 0), 2),
  0,
  ROUND(
    COALESCE(pl.regular_hours, pl.hours, 0) * COALESCE(pl.rate, 0)
    + COALESCE(pl.overtime_hours, 0) * COALESCE(pl.rate, 0),
    2
  ),
  'backfill_from_payroll_line',
  pl.calculation_version
FROM public.payroll_lines pl
JOIN public.payroll_batches pb ON pb.id = pl.batch_id
WHERE pl.month IN ('2026-08', '2026-09')
  AND NOT EXISTS (
    SELECT 1
    FROM public.payroll_site_allocations a
    WHERE a.payroll_line_id = pl.id
  );

-- ============ 3) VERIFY ============
-- You should see rows for 2026-08 and 2026-09, and none for 2026-10.
SELECT month, count(*) AS allocation_rows
FROM public.payroll_site_allocations
GROUP BY month
ORDER BY month;

SELECT month, count(*) AS batches
FROM public.payroll_batches
GROUP BY month
ORDER BY month;
