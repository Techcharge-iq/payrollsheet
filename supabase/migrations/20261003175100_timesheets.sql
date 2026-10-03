CREATE TABLE public.timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  site TEXT NOT NULL CHECK (length(btrim(site)) > 0),
  foreman TEXT NOT NULL CHECK (length(btrim(foreman)) > 0),
  work_date DATE NOT NULL,
  in_time TIME NOT NULL,
  out_time TIME NOT NULL,
  break_hours NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (break_hours >= 0 AND break_hours <= 24),
  total_hours NUMERIC(6, 3) GENERATED ALWAYS AS (
    round((EXTRACT(EPOCH FROM (out_time - in_time)) / 3600 - break_hours)::numeric, 3)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT timesheets_shift_must_end_after_start CHECK (out_time > in_time),
  CONSTRAINT timesheets_break_within_shift CHECK (
    break_hours <= EXTRACT(EPOCH FROM (out_time - in_time)) / 3600
  ),
  CONSTRAINT timesheets_one_entry_per_employee_day UNIQUE (employee_id, work_date)
);

CREATE INDEX timesheets_work_date_idx ON public.timesheets (work_date DESC);
CREATE INDEX timesheets_site_work_date_idx ON public.timesheets (site, work_date DESC);

ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timesheets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheets TO authenticated;
GRANT ALL ON public.timesheets TO service_role;

CREATE POLICY "timesheets_admin_all"
  ON public.timesheets FOR ALL TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));
CREATE POLICY "timesheets_staff_read"
  ON public.timesheets FOR SELECT TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']));
CREATE POLICY "timesheets_staff_insert"
  ON public.timesheets FOR INSERT TO authenticated
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));
CREATE POLICY "timesheets_staff_update"
  ON public.timesheets FOR UPDATE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));

CREATE TRIGGER timesheets_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

NOTIFY pgrst, 'reload schema';
