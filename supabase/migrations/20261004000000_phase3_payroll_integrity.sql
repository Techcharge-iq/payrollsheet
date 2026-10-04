ALTER TABLE public.timesheets
  ADD COLUMN status TEXT NOT NULL DEFAULT 'PRESENT',
  ADD COLUMN overtime_hours NUMERIC(6, 3) NOT NULL DEFAULT 0,
  ADD COLUMN remarks TEXT,
  ADD COLUMN regular_hours NUMERIC(6, 3) GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PRESENT', 'HALF_DAY') AND in_time IS NOT NULL AND out_time IS NOT NULL
      THEN round(
        (
          EXTRACT(EPOCH FROM (out_time - in_time)) / 3600
          - break_hours
          - overtime_hours
        )::numeric,
        3
      )
      ELSE 0::numeric
    END
  ) STORED;

ALTER TABLE public.timesheets
  ALTER COLUMN in_time DROP NOT NULL,
  ALTER COLUMN out_time DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS timesheets_shift_must_end_after_start,
  DROP CONSTRAINT IF EXISTS timesheets_break_within_shift,
  ADD CONSTRAINT timesheets_status_check
    CHECK (status IN ('PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'HALF_DAY')),
  ADD CONSTRAINT timesheets_overtime_nonnegative_check CHECK (overtime_hours >= 0),
  ADD CONSTRAINT timesheets_attendance_consistency_check CHECK (
    (
      status IN ('PRESENT', 'HALF_DAY')
      AND in_time IS NOT NULL
      AND out_time IS NOT NULL
      AND out_time > in_time
      AND break_hours >= 0
      AND break_hours <= EXTRACT(EPOCH FROM (out_time - in_time)) / 3600
      AND overtime_hours <=
        EXTRACT(EPOCH FROM (out_time - in_time)) / 3600 - break_hours
    )
    OR (
      status IN ('ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF')
      AND in_time IS NULL
      AND out_time IS NULL
      AND break_hours = 0
      AND overtime_hours = 0
    )
  );

CREATE INDEX timesheets_employee_work_date_idx
  ON public.timesheets (employee_id, work_date DESC);

ALTER TABLE public.payroll_batches
  ADD COLUMN status TEXT NOT NULL DEFAULT 'LEGACY'
    CHECK (status IN ('LEGACY', 'DRAFT', 'REVIEW', 'APPROVED', 'LOCKED', 'PAID')),
  ADD COLUMN approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN locked_at TIMESTAMPTZ,
  ADD COLUMN paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN paid_at TIMESTAMPTZ;

ALTER TABLE public.payroll_batches
  ALTER COLUMN status SET DEFAULT 'DRAFT';

ALTER TABLE public.payroll_lines
  ADD COLUMN calculation_version TEXT,
  ADD COLUMN regular_hours NUMERIC(10, 3),
  ADD COLUMN overtime_hours NUMERIC(10, 3),
  ADD COLUMN regular_pay NUMERIC(12, 3),
  ADD COLUMN overtime_pay NUMERIC(12, 3),
  ADD COLUMN allowances NUMERIC(12, 3),
  ADD COLUMN gross_pay NUMERIC(12, 3),
  ADD COLUMN deductions NUMERIC(12, 3),
  ADD COLUMN advance_recovery NUMERIC(12, 3),
  ADD COLUMN net_pay NUMERIC(12, 3);

ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_snapshot_consistency_check CHECK (
    calculation_version IS NULL
    OR (
      regular_hours IS NOT NULL
      AND overtime_hours IS NOT NULL
      AND regular_pay IS NOT NULL
      AND overtime_pay IS NOT NULL
      AND allowances IS NOT NULL
      AND gross_pay IS NOT NULL
      AND deductions IS NOT NULL
      AND advance_recovery IS NOT NULL
      AND net_pay IS NOT NULL
      AND
      regular_hours >= 0
      AND overtime_hours >= 0
      AND regular_pay >= 0
      AND overtime_pay >= 0
      AND allowances >= 0
      AND gross_pay >= 0
      AND deductions >= 0
      AND advance_recovery >= 0
      AND net_pay >= 0
      AND abs(hours - regular_hours - overtime_hours) <= 0.001
      AND abs(gross_pay - regular_pay - overtime_pay - allowances) <= 0.001
      AND abs(deductions - food_deduction - other_deduction) <= 0.001
      AND abs(advance_recovery - prev_advance) <= 0.001
      AND abs(net_pay - net_salary) <= 0.001
      AND abs(net_pay - greatest(0, gross_pay - deductions - advance_recovery)) <= 0.001
    )
  );

CREATE TABLE public.payroll_site_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_line_id UUID NOT NULL REFERENCES public.payroll_lines(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  month TEXT NOT NULL,
  site TEXT NOT NULL CHECK (length(btrim(site)) > 0),
  foreman TEXT NOT NULL DEFAULT 'Unassigned',
  regular_hours NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0),
  overtime_hours NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  allocated_regular_pay NUMERIC(12, 3) NOT NULL DEFAULT 0,
  allocated_overtime_pay NUMERIC(12, 3) NOT NULL DEFAULT 0,
  allocated_allowances NUMERIC(12, 3) NOT NULL DEFAULT 0,
  allocated_gross_cost NUMERIC(12, 3) NOT NULL DEFAULT 0,
  allocation_basis TEXT NOT NULL
    CHECK (allocation_basis IN ('ATTENDANCE_HOURS', 'LEGACY_ESTIMATED')),
  calculation_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_site_allocations_line_site_foreman_unique
    UNIQUE (payroll_line_id, site, foreman)
);

CREATE INDEX payroll_site_allocations_month_site_idx
  ON public.payroll_site_allocations (month, site);
CREATE INDEX payroll_site_allocations_employee_month_idx
  ON public.payroll_site_allocations (employee_id, month);

ALTER TABLE public.payroll_site_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_site_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_site_allocations TO authenticated;
GRANT ALL ON public.payroll_site_allocations TO service_role;

CREATE POLICY "payroll_site_allocations_admin_all"
  ON public.payroll_site_allocations FOR ALL TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));
CREATE POLICY "payroll_site_allocations_staff_read"
  ON public.payroll_site_allocations FOR SELECT TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']));
REVOKE INSERT, UPDATE, DELETE ON public.payroll_site_allocations FROM authenticated;

CREATE OR REPLACE FUNCTION public.enforce_payroll_batch_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'New payroll batches must start in DRAFT';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.locked_by := NULL;
    NEW.locked_at := NULL;
    NEW.paid_by := NULL;
    NEW.paid_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT', 'REVIEW') THEN
      RAISE EXCEPTION 'Only DRAFT or REVIEW payroll batches can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('PAID', 'LEGACY') THEN
    RAISE EXCEPTION 'Payroll batch in % status cannot be edited', OLD.status;
  END IF;

  IF OLD.status = 'LOCKED' THEN
    IF NEW.status <> 'PAID'
       OR NEW.month IS DISTINCT FROM OLD.month
       OR NEW.site IS DISTINCT FROM OLD.site
       OR NEW.foreman IS DISTINCT FROM OLD.foreman
       OR NOT public.has_payroll_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Locked payroll batches are immutable except for authorized payment';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.has_payroll_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only an administrator can change payroll lifecycle status';
    END IF;
    IF NOT (
      (OLD.status = 'DRAFT' AND NEW.status = 'REVIEW')
      OR (OLD.status = 'REVIEW' AND NEW.status = 'DRAFT')
      OR (OLD.status = 'REVIEW' AND NEW.status = 'APPROVED')
      OR (OLD.status = 'APPROVED' AND NEW.status = 'LOCKED')
      OR (OLD.status = 'LOCKED' AND NEW.status = 'PAID')
    ) THEN
      RAISE EXCEPTION 'Invalid payroll lifecycle transition: % to %', OLD.status, NEW.status;
    END IF;

    IF NEW.status <> 'APPROVED'
       AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
      RAISE EXCEPTION 'Approval metadata is managed by the lifecycle transition';
    END IF;
    IF NEW.status <> 'LOCKED'
       AND (NEW.locked_by IS DISTINCT FROM OLD.locked_by
         OR NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
      RAISE EXCEPTION 'Lock metadata is managed by the lifecycle transition';
    END IF;
    IF NEW.status <> 'PAID'
       AND (NEW.paid_by IS DISTINCT FROM OLD.paid_by
         OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
      RAISE EXCEPTION 'Payment metadata is managed by the lifecycle transition';
    END IF;

    IF NEW.status = 'APPROVED' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.payroll_lines
        WHERE batch_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'A payroll batch must contain at least one line before approval';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.payroll_lines
        WHERE batch_id = NEW.id
          AND (
            calculation_version IS NULL
            OR regular_hours IS NULL
            OR overtime_hours IS NULL
            OR regular_pay IS NULL
            OR overtime_pay IS NULL
            OR allowances IS NULL
            OR gross_pay IS NULL
            OR deductions IS NULL
            OR advance_recovery IS NULL
            OR net_pay IS NULL
          )
      ) THEN
        RAISE EXCEPTION 'Every payroll line must have a complete calculation snapshot before approval';
      END IF;
      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    ELSIF NEW.status = 'LOCKED' THEN
      NEW.locked_by := auth.uid();
      NEW.locked_at := now();
    ELSIF NEW.status = 'PAID' THEN
      NEW.paid_by := auth.uid();
      NEW.paid_at := now();
    END IF;
  ELSIF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
     OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Payroll lifecycle metadata cannot be edited directly';
  END IF;

  IF OLD.status = 'APPROVED' AND (
    NEW.month IS DISTINCT FROM OLD.month
    OR NEW.site IS DISTINCT FROM OLD.site
    OR NEW.foreman IS DISTINCT FROM OLD.foreman
    OR NEW.status NOT IN ('LOCKED')
  ) THEN
    RAISE EXCEPTION 'Approved payroll batches are finalized and cannot be edited';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_batches_lifecycle_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_batches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_batch_lifecycle();

CREATE OR REPLACE FUNCTION public.enforce_payroll_line_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status TEXT;
  old_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO old_status
    FROM public.payroll_batches
    WHERE id = OLD.batch_id
    FOR UPDATE;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO current_status
    FROM public.payroll_batches
    WHERE id = NEW.batch_id
    FOR UPDATE;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_status NOT IN ('DRAFT', 'REVIEW') THEN
      RAISE EXCEPTION 'Payroll lines can only be added to DRAFT or REVIEW batches';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF old_status NOT IN ('DRAFT', 'REVIEW') THEN
      RAISE EXCEPTION 'Payroll lines cannot be deleted from % batches', old_status;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     AND old_status NOT IN ('DRAFT', 'REVIEW') THEN
    RAISE EXCEPTION 'Payroll lines cannot be moved from % batches', old_status;
  END IF;

  IF current_status IN ('LOCKED', 'LEGACY') OR current_status IS NULL THEN
    RAISE EXCEPTION 'Payroll lines cannot be edited in % batches', COALESCE(current_status, 'missing');
  ELSIF current_status = 'PAID' THEN
    IF (to_jsonb(NEW) - 'paid') IS DISTINCT FROM (to_jsonb(OLD) - 'paid')
       OR NEW.paid < 0
       OR NEW.paid > NEW.net_salary
       OR NOT public.has_payroll_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only an administrator may update payment metadata on PAID payroll lines';
    END IF;
  ELSIF current_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved payroll lines are finalized';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_lines_lifecycle_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_line_lifecycle();

CREATE OR REPLACE FUNCTION public.enforce_payroll_allocation_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line_id UUID;
  batch_status TEXT;
BEGIN
  line_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.payroll_line_id ELSE NEW.payroll_line_id END;
  SELECT b.status INTO batch_status
  FROM public.payroll_lines l
  JOIN public.payroll_batches b ON b.id = l.batch_id
  WHERE l.id = line_id
  FOR UPDATE OF b;

  IF batch_status IS DISTINCT FROM 'DRAFT' AND batch_status IS DISTINCT FROM 'REVIEW' THEN
    RAISE EXCEPTION 'Site allocations can only be changed for DRAFT or REVIEW payroll';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_site_allocations_lifecycle_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_site_allocations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_allocation_lifecycle();

CREATE OR REPLACE FUNCTION public.refresh_payroll_site_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allocation_row RECORD;
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

  IF row_count = 0 OR total_hours = 0 THEN
    RETURN NEW;
  END IF;

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

CREATE TRIGGER payroll_lines_site_allocation_trg
  AFTER INSERT OR UPDATE OF
    employee_id, month, calculation_version, regular_hours, overtime_hours,
    regular_pay, overtime_pay, allowances, gross_pay
  ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.refresh_payroll_site_allocations();

CREATE TRIGGER payroll_site_allocations_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.payroll_site_allocations
  FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

CREATE OR REPLACE FUNCTION public.payroll_advance_balances_before(target_month TEXT)
RETURNS TABLE (employee_id BIGINT, balance NUMERIC)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    payroll_lines.employee_id,
    greatest(0, round(sum(payroll_lines.new_advance - payroll_lines.prev_advance), 3)) AS balance
  FROM public.payroll_lines
  WHERE payroll_lines.month < target_month
  GROUP BY payroll_lines.employee_id
$$;

REVOKE ALL ON FUNCTION public.payroll_advance_balances_before(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_advance_balances_before(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_payroll_batch_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_payroll_line_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_payroll_allocation_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_payroll_site_allocations() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
