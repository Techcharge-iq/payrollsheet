-- Add effective-dated workforce and leave records without backfilling unknown history.
-- Existing employee hourly_rate remains the current value; only future observed changes are recorded.

ALTER TABLE public.payroll_lines
  ADD COLUMN rate_segments JSONB,
  ADD CONSTRAINT payroll_lines_rate_segments_array_check
    CHECK (rate_segments IS NULL OR jsonb_typeof(rate_segments) = 'array');

CREATE TABLE public.employee_salary_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  hourly_rate NUMERIC(12, 3) NOT NULL CHECK (hourly_rate >= 0),
  effective_on DATE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employee_salary_history_employee_effective_idx
  ON public.employee_salary_history (employee_id, effective_on DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_employee_salary_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.hourly_rate IS DISTINCT FROM OLD.hourly_rate THEN
    INSERT INTO public.employee_salary_history(employee_id, hourly_rate, effective_on, created_by)
    VALUES (NEW.id, NEW.hourly_rate, CURRENT_DATE, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employees_salary_history_trg
  AFTER INSERT OR UPDATE OF hourly_rate ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.record_employee_salary_change();
REVOKE ALL ON FUNCTION public.record_employee_salary_change() FROM PUBLIC, anon, authenticated;

-- Record today's known current rates as a baseline; do not invent earlier salary history.
INSERT INTO public.employee_salary_history(employee_id, hourly_rate, effective_on)
SELECT id, hourly_rate, CURRENT_DATE FROM public.employees;

CREATE TABLE public.employee_site_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  site TEXT NOT NULL CHECK (length(btrim(site)) > 0),
  foreman TEXT NOT NULL DEFAULT '',
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX employee_site_assignments_one_current_idx
  ON public.employee_site_assignments(employee_id) WHERE effective_to IS NULL;
CREATE INDEX employee_site_assignments_employee_dates_idx
  ON public.employee_site_assignments(employee_id, effective_from DESC);

CREATE TABLE public.employee_transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  from_site TEXT,
  to_site TEXT NOT NULL CHECK (length(btrim(to_site)) > 0),
  to_foreman TEXT NOT NULL DEFAULT '',
  effective_on DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employee_transfer_requests_status_date_idx
  ON public.employee_transfer_requests(status, effective_on);

CREATE OR REPLACE FUNCTION public.apply_employee_transfer_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'New transfer requests must start as PENDING';
    END IF;
    NEW.requested_by := auth.uid();
    RETURN NEW;
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status = 'PENDING' THEN
    IF NOT public.has_payroll_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only an administrator can approve employee transfers';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.employee_site_assignments
      WHERE employee_id = NEW.employee_id
        AND effective_to IS NULL
        AND effective_from >= NEW.effective_on
    ) THEN
      RAISE EXCEPTION 'Transfer effective date must follow the current assignment start date';
    END IF;
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
    UPDATE public.employee_site_assignments
       SET effective_to = NEW.effective_on - 1
     WHERE employee_id = NEW.employee_id
       AND effective_to IS NULL
       AND effective_from < NEW.effective_on;
    INSERT INTO public.employee_site_assignments(employee_id, site, foreman, effective_from, created_by)
    VALUES (NEW.employee_id, NEW.to_site, NEW.to_foreman, NEW.effective_on, auth.uid());
  ELSIF NEW.status IN ('APPROVED', 'REJECTED') AND OLD.status = 'PENDING' THEN
    IF NOT public.has_payroll_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only an administrator can approve or reject employee transfers';
    END IF;
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Reviewed transfer requests cannot be changed';
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'PENDING'
        AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Reviewed transfer requests are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_transfer_approval_trg
  BEFORE INSERT OR UPDATE OF status ON public.employee_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.apply_employee_transfer_approval();
REVOKE ALL ON FUNCTION public.apply_employee_transfer_approval() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_leave_request_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'New leave requests must start as PENDING';
    END IF;
    NEW.requested_by := auth.uid();
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Only pending leave requests can be reviewed';
    END IF;
    IF NEW.status IN ('APPROVED', 'REJECTED')
       AND NOT public.has_payroll_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Only an administrator can approve or reject leave requests';
    END IF;
    IF NEW.status IN ('APPROVED', 'REJECTED') THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'PENDING'
        AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Reviewed leave requests are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leave_requests_review_trg
  BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_leave_request_review();
REVOKE ALL ON FUNCTION public.protect_leave_request_review() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
  annual_entitlement_days NUMERIC(7, 2) CHECK (annual_entitlement_days IS NULL OR annual_entitlement_days >= 0),
  payroll_treatment TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (payroll_treatment IN ('PAID', 'UNPAID', 'MANUAL')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  requested_days NUMERIC(7, 2) NOT NULL CHECK (requested_days > 0),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX leave_requests_employee_dates_idx ON public.leave_requests(employee_id, start_date, end_date);
CREATE INDEX leave_requests_status_idx ON public.leave_requests(status, start_date);

-- Admin/HR may manage operational records; only admins may approve transfers and leave.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_salary_history', 'employee_site_assignments',
    'employee_transfer_requests', 'leave_types', 'leave_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_payroll_role(ARRAY[''admin'', ''hr'']))',
      t || '_staff_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_payroll_role(ARRAY[''admin'', ''hr'']))',
      t || '_staff_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_payroll_role(ARRAY[''admin'', ''hr''])) WITH CHECK (public.has_payroll_role(ARRAY[''admin'', ''hr'']))',
      t || '_staff_update', t
    );
  END LOOP;
END $$;

REVOKE UPDATE, DELETE ON public.employee_salary_history FROM authenticated;
REVOKE UPDATE, DELETE ON public.employee_site_assignments FROM authenticated;

-- Audit changes to workforce and leave records with the existing append-only audit trail.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_salary_history', 'employee_site_assignments',
    'employee_transfer_requests', 'leave_types', 'leave_requests'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log()',
      t || '_audit_log_trg', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
