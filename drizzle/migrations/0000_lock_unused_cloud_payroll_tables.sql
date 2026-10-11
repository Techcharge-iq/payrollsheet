DROP POLICY IF EXISTS employees_public_all ON public.employees;
DROP POLICY IF EXISTS payroll_batches_public_all ON public.payroll_batches;
DROP POLICY IF EXISTS payroll_lines_public_all ON public.payroll_lines;
REVOKE ALL ON public.employees, public.payroll_batches, public.payroll_lines FROM anon;