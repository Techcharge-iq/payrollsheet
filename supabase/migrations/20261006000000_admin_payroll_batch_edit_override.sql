CREATE OR REPLACE FUNCTION public.enforce_payroll_batch_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin BOOLEAN := public.has_payroll_role(ARRAY['admin']);
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

  IF NOT is_admin THEN
    IF OLD.status IN ('PAID', 'LEGACY') THEN
      RAISE EXCEPTION 'Payroll batch in % status cannot be edited', OLD.status;
    END IF;

    IF OLD.status = 'LOCKED' AND (
      NEW.status <> 'PAID'
      OR NEW.month IS DISTINCT FROM OLD.month
      OR NEW.site IS DISTINCT FROM OLD.site
      OR NEW.foreman IS DISTINCT FROM OLD.foreman
    ) THEN
      RAISE EXCEPTION 'Locked payroll batches are immutable except for authorized payment';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT is_admin THEN
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

  IF NOT is_admin AND OLD.status = 'APPROVED' AND (
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

CREATE OR REPLACE FUNCTION public.enforce_payroll_line_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status TEXT;
  old_status TEXT;
  is_admin BOOLEAN := public.has_payroll_role(ARRAY['admin']);
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
    IF current_status IS NULL THEN
      RAISE EXCEPTION 'Payroll batch does not exist';
    END IF;
    IF NOT is_admin AND current_status NOT IN ('DRAFT', 'REVIEW') THEN
      RAISE EXCEPTION 'Payroll lines can only be added to DRAFT or REVIEW batches';
    END IF;
    IF current_status = 'PAID' AND (NEW.paid < 0 OR NEW.paid > NEW.net_salary) THEN
      RAISE EXCEPTION 'Paid amount must be between zero and net salary';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF old_status IS NULL THEN
      RAISE EXCEPTION 'Payroll batch does not exist';
    END IF;
    IF NOT is_admin AND old_status NOT IN ('DRAFT', 'REVIEW') THEN
      RAISE EXCEPTION 'Payroll lines cannot be deleted from % batches', old_status;
    END IF;
    RETURN OLD;
  END IF;

  IF old_status IS NULL OR current_status IS NULL THEN
    RAISE EXCEPTION 'Payroll batch does not exist';
  END IF;

  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     AND NOT is_admin
     AND old_status NOT IN ('DRAFT', 'REVIEW') THEN
    RAISE EXCEPTION 'Payroll lines cannot be moved from % batches', old_status;
  END IF;

  IF NOT is_admin THEN
    IF current_status IN ('LOCKED', 'LEGACY') THEN
      RAISE EXCEPTION 'Payroll lines cannot be edited in % batches', current_status;
    ELSIF current_status = 'PAID' THEN
      IF (to_jsonb(NEW) - 'paid') IS DISTINCT FROM (to_jsonb(OLD) - 'paid')
         OR NEW.paid < 0
         OR NEW.paid > NEW.net_salary THEN
        RAISE EXCEPTION 'Only payment metadata may be updated on PAID payroll lines';
      END IF;
    ELSIF current_status = 'APPROVED' THEN
      RAISE EXCEPTION 'Approved payroll lines are finalized';
    END IF;
  ELSIF current_status = 'PAID' AND (NEW.paid < 0 OR NEW.paid > NEW.net_salary) THEN
    RAISE EXCEPTION 'Paid amount must be between zero and net salary';
  END IF;

  RETURN NEW;
END;
$$;

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

  IF NOT public.has_payroll_role(ARRAY['admin'])
     AND batch_status IS DISTINCT FROM 'DRAFT'
     AND batch_status IS DISTINCT FROM 'REVIEW' THEN
    RAISE EXCEPTION 'Site allocations can only be changed for DRAFT or REVIEW payroll';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
