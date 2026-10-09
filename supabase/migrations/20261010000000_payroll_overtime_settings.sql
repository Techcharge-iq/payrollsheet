-- Store the organization overtime rule and the multiplier used on each saved payroll line.
ALTER TABLE public.payroll_lines
  ADD COLUMN overtime_multiplier NUMERIC(8, 4),
  ADD CONSTRAINT payroll_lines_overtime_multiplier_check
    CHECK (overtime_multiplier IS NULL OR overtime_multiplier > 0);

CREATE TABLE public.payroll_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  overtime_multiplier NUMERIC(8, 4) CHECK (overtime_multiplier IS NULL OR overtime_multiplier > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.payroll_settings(singleton, overtime_multiplier) VALUES (TRUE, NULL);
ALTER TABLE public.payroll_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_settings FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.payroll_settings TO authenticated;
CREATE POLICY payroll_settings_staff_read ON public.payroll_settings
  FOR SELECT TO authenticated USING (public.has_payroll_role(ARRAY['admin', 'hr']));
CREATE POLICY payroll_settings_admin_update ON public.payroll_settings
  FOR UPDATE TO authenticated USING (public.has_payroll_role(ARRAY['admin']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));
CREATE OR REPLACE FUNCTION public.stamp_payroll_settings_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.singleton := TRUE;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_settings_updated_at_trg BEFORE UPDATE ON public.payroll_settings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_payroll_settings_update();
REVOKE ALL ON FUNCTION public.stamp_payroll_settings_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payroll_settings_audit_log_trg AFTER UPDATE ON public.payroll_settings
  FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

NOTIFY pgrst, 'reload schema';
