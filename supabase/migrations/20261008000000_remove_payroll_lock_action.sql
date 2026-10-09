-- Stop creating new LOCKED batches. Existing LOCKED rows and their metadata remain readable,
-- and may still transition to PAID through the established admin payment action.
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
      OR (OLD.status = 'APPROVED' AND NEW.status = 'PAID')
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
