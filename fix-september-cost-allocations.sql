-- ============================================================================
-- Fix Missing September (and Historical) Cost Allocation Details
--
-- Why September was missing:
-- 1) The database trigger `refresh_payroll_site_allocations()` only allocated
--    labour cost when rows existed in `public.timesheets`. If attendance wasn't
--    recorded or total hours was 0, it deleted any existing allocation and
--    inserted 0 rows, failing to fall back to the saved batch site.
-- 2) Batches saved or updated for September thus lost or never received their
--    allocation rows in `public.payroll_site_allocations`.
--
-- Running this script in your Supabase SQL Editor:
-- 1) Fixes `refresh_payroll_site_allocations()` to automatically fall back to
--    the batch's site & foreman ('LEGACY_ESTIMATED') whenever attendance is missing.
-- 2) Backfills `payroll_site_allocations` for September (and any other month)
--    from existing payroll lines.
-- 3) Ensures project_id is linked for manager role permissions.
-- ============================================================================

-- 1) UPDATE TRIGGER FUNCTION TO SUPPORT FALLBACK TO BATCH SITE
CREATE OR REPLACE FUNCTION public.refresh_payroll_site_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allocation_row RECORD;
  batch_row RECORD;
  total_regular NUMERIC(12, 3);
  total_overtime NUMERIC(12, 3);
  total_hours NUMERIC(12, 3);
  allocated_before NUMERIC(12, 3) := 0;
  row_number INTEGER := 0;
  row_count INTEGER := 0;
  regular_cost NUMERIC(12, 3);
  overtime_cost NUMERIC(12, 3);
  allowance_cost NUMERIC(12, 3);
  gross_cost NUMERIC(12, 3);
  reg_hours NUMERIC(12, 3);
  ot_hours NUMERIC(12, 3);
BEGIN
  DELETE FROM public.payroll_site_allocations
  WHERE payroll_line_id = NEW.id;

  IF NEW.calculation_version IS NULL OR NEW.gross_pay IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(sum(regular_hours), 0),
    COALESCE(sum(overtime_hours), 0),
    COALESCE(sum(regular_hours + overtime_hours), 0),
    count(*)
  INTO total_regular, total_overtime, total_hours, row_count
  FROM (
    SELECT
      site,
      foreman,
      sum(regular_hours) AS regular_hours,
      sum(overtime_hours) AS overtime_hours
    FROM public.timesheets
    WHERE employee_id = NEW.employee_id
      AND work_date >= (NEW.month || '-01')::date
      AND work_date < ((NEW.month || '-01')::date + INTERVAL '1 month')
      AND regular_hours + overtime_hours > 0
    GROUP BY site, foreman
  ) site_hours;

  -- Fallback to batch site when timesheets are not available
  IF row_count = 0 OR total_hours = 0 THEN
    SELECT * INTO batch_row
    FROM public.payroll_batches
    WHERE id = NEW.batch_id;

    reg_hours := COALESCE(NEW.regular_hours, GREATEST(COALESCE(NEW.hours, 0) - COALESCE(NEW.overtime_hours, 0), 0), 0);
    ot_hours := COALESCE(NEW.overtime_hours, 0);

    INSERT INTO public.payroll_site_allocations (
      payroll_line_id,
      employee_id,
      month,
      site,
      foreman,
      project_id,
      regular_hours,
      overtime_hours,
      allocated_regular_pay,
      allocated_overtime_pay,
      allocated_allowances,
      allocated_gross_cost,
      allocation_basis,
      calculation_version
    )
    VALUES (
      NEW.id,
      NEW.employee_id,
      NEW.month,
      COALESCE(NULLIF(btrim(batch_row.site), ''), 'Unassigned'),
      COALESCE(NULLIF(btrim(NEW.foreman), ''), NULLIF(btrim(batch_row.foreman), ''), 'Unassigned'),
      batch_row.project_id,
      reg_hours,
      ot_hours,
      COALESCE(NEW.regular_pay, reg_hours * COALESCE(NEW.rate, 0), 0),
      COALESCE(NEW.overtime_pay, ot_hours * COALESCE(NEW.rate, 0), 0),
      COALESCE(NEW.allowances, 0),
      COALESCE(NEW.gross_pay, 0),
      'LEGACY_ESTIMATED',
      NEW.calculation_version
    );

    RETURN NEW;
  END IF;

  -- Allocate by attendance hours
  row_number := 0;
  FOR allocation_row IN
    SELECT
      site,
      foreman,
      sum(regular_hours) AS regular_hours,
      sum(overtime_hours) AS overtime_hours
    FROM public.timesheets
    WHERE employee_id = NEW.employee_id
      AND work_date >= (NEW.month || '-01')::date
      AND work_date < ((NEW.month || '-01')::date + INTERVAL '1 month')
      AND regular_hours + overtime_hours > 0
    GROUP BY site, foreman
    ORDER BY site, foreman
  LOOP
    row_number := row_number + 1;
    regular_cost := CASE
      WHEN total_regular > 0
        THEN round(COALESCE(NEW.regular_pay, 0) * allocation_row.regular_hours / total_regular, 3)
      ELSE 0
    END;
    overtime_cost := CASE
      WHEN total_overtime > 0
        THEN round(COALESCE(NEW.overtime_pay, 0) * allocation_row.overtime_hours / total_overtime, 3)
      ELSE 0
    END;
    allowance_cost := round(
      COALESCE(NEW.allowances, 0)
      * (allocation_row.regular_hours + allocation_row.overtime_hours)
      / total_hours,
      3
    );

    IF row_number = row_count THEN
      gross_cost := round(COALESCE(NEW.gross_pay, 0) - allocated_before, 3);
    ELSE
      gross_cost := regular_cost + overtime_cost + allowance_cost;
      allocated_before := allocated_before + gross_cost;
    END IF;

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
    VALUES (
      NEW.id,
      NEW.employee_id,
      NEW.month,
      allocation_row.site,
      allocation_row.foreman,
      allocation_row.regular_hours,
      allocation_row.overtime_hours,
      regular_cost,
      overtime_cost,
      allowance_cost,
      gross_cost,
      'ATTENDANCE_HOURS',
      NEW.calculation_version
    );
  END LOOP;

  RETURN NEW;
END;
$$;


-- 2) BACKFILL MISSING SITE ALLOCATIONS (ESPECIALLY SEPTEMBER)
ALTER TABLE public.payroll_site_allocations
  DISABLE TRIGGER payroll_site_allocations_lifecycle_trg;

INSERT INTO public.payroll_site_allocations (
  payroll_line_id,
  employee_id,
  month,
  site,
  foreman,
  project_id,
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
  batch.project_id,
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
    COALESCE(line.regular_hours, GREATEST(COALESCE(line.hours, 0) - COALESCE(line.overtime_hours, 0), 0), 0) AS regular_hours,
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
  FROM public.payroll_site_allocations AS a
  WHERE a.payroll_line_id = line.id
);

ALTER TABLE public.payroll_site_allocations
  ENABLE TRIGGER payroll_site_allocations_lifecycle_trg;


-- 3) LINK PROJECT_ID FOR MANAGER PERMISSIONS
UPDATE public.payroll_site_allocations AS allocation
SET project_id = project.id
FROM public.projects AS project
WHERE allocation.project_id IS NULL
  AND btrim(allocation.site) = project.name;

NOTIFY pgrst, 'reload schema';


-- 4) VERIFY ALLOCATION COUNTS BY MONTH
SELECT
  month,
  count(*) AS allocation_rows,
  round(sum(allocated_gross_cost), 3) AS total_gross_cost
FROM public.payroll_site_allocations
GROUP BY month
ORDER BY month;

