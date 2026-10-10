ALTER TABLE public.users
  ADD COLUMN full_name TEXT,
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check,
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'hr', 'manager', 'foreman'));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON public.users (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
  code TEXT UNIQUE CHECK (code IS NULL OR length(btrim(code)) > 0),
  location TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_foreman_user_idx
  ON public.projects (foreman_user_id)
  WHERE foreman_user_id IS NOT NULL;
CREATE INDEX projects_active_name_idx ON public.projects (active, name);

CREATE TABLE public.manager_project_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  manager_user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (manager_user_id, project_id)
);
CREATE INDEX manager_project_assignments_project_idx
  ON public.manager_project_assignments (project_id, manager_user_id);

ALTER TABLE public.payroll_batches
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.payroll_lines
  ADD COLUMN foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.timesheets
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.payroll_site_allocations
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.employee_site_assignments
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;
ALTER TABLE public.employee_transfer_requests
  ADD COLUMN from_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN to_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN to_foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL;

INSERT INTO public.projects (name)
SELECT DISTINCT btrim(site)
FROM (
  SELECT site FROM public.payroll_batches
  UNION ALL SELECT site FROM public.timesheets
  UNION ALL SELECT site FROM public.payroll_site_allocations
  UNION ALL SELECT site FROM public.employee_site_assignments
  UNION ALL SELECT to_site FROM public.employee_transfer_requests
  UNION ALL SELECT from_site FROM public.employee_transfer_requests
) AS legacy_sites
WHERE site IS NOT NULL AND length(btrim(site)) > 0
  AND lower(btrim(site)) <> 'multiple sites'
ON CONFLICT (name) DO NOTHING;

UPDATE public.payroll_batches AS batch
SET project_id = project.id
FROM public.projects AS project
WHERE batch.project_id IS NULL
  AND btrim(batch.site) = project.name;

UPDATE public.timesheets AS timesheet
SET project_id = project.id
FROM public.projects AS project
WHERE timesheet.project_id IS NULL
  AND btrim(timesheet.site) = project.name;

UPDATE public.payroll_site_allocations AS allocation
SET project_id = project.id
FROM public.projects AS project
WHERE allocation.project_id IS NULL
  AND btrim(allocation.site) = project.name;

UPDATE public.employee_site_assignments AS assignment
SET project_id = project.id
FROM public.projects AS project
WHERE assignment.project_id IS NULL
  AND btrim(assignment.site) = project.name;

UPDATE public.employee_transfer_requests AS transfer
SET to_project_id = project.id
FROM public.projects AS project
WHERE transfer.to_project_id IS NULL
  AND btrim(transfer.to_site) = project.name;

UPDATE public.employee_transfer_requests AS transfer
SET from_project_id = project.id
FROM public.projects AS project
WHERE transfer.from_project_id IS NULL
  AND btrim(transfer.from_site) = project.name;

CREATE INDEX payroll_batches_project_month_idx
  ON public.payroll_batches (project_id, month);
CREATE INDEX payroll_site_allocations_project_month_idx
  ON public.payroll_site_allocations (project_id, month);
CREATE INDEX timesheets_project_date_idx
  ON public.timesheets (project_id, work_date DESC);
CREATE INDEX employee_site_assignments_project_employee_idx
  ON public.employee_site_assignments (project_id, employee_id, effective_from DESC);
CREATE INDEX employee_transfer_requests_project_status_idx
  ON public.employee_transfer_requests (to_project_id, status, effective_on);

CREATE OR REPLACE FUNCTION public.has_payroll_role(required_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE user_id = auth.uid()
      AND is_active
      AND role = ANY (required_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_payroll_role(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_payroll_role(TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_project(target_project_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_project_id IS NOT NULL AND (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND EXISTS (
        SELECT 1
        FROM public.manager_project_assignments assignment
        WHERE assignment.manager_user_id = auth.uid()
          AND assignment.project_id = target_project_id
      )
    )
    OR (
      public.has_payroll_role(ARRAY['foreman'])
      AND EXISTS (
        SELECT 1 FROM public.projects project
        WHERE project.id = target_project_id
          AND project.foreman_user_id = auth.uid()
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_employee(target_employee_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_payroll_role(ARRAY['admin', 'hr'])
    OR EXISTS (
      SELECT 1
      FROM public.employee_site_assignments assignment
      WHERE assignment.employee_id = target_employee_id
        AND assignment.effective_to IS NULL
        AND assignment.project_id IS NOT NULL
        AND public.can_access_project(assignment.project_id)
        AND (
          public.has_payroll_role(ARRAY['manager'])
          OR (
            public.has_payroll_role(ARRAY['foreman'])
            AND assignment.foreman_user_id = auth.uid()
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_employee_project(
  target_employee_id BIGINT,
  target_project_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_project_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.employee_site_assignments assignment
    WHERE assignment.employee_id = target_employee_id
      AND assignment.effective_to IS NULL
      AND assignment.project_id = target_project_id
      AND (
        public.has_payroll_role(ARRAY['admin', 'hr'])
        OR (
          public.has_payroll_role(ARRAY['manager'])
          AND public.can_access_project(target_project_id)
        )
        OR (
          public.has_payroll_role(ARRAY['foreman'])
          AND assignment.foreman_user_id = auth.uid()
          AND public.can_access_project(target_project_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_payroll_batch(target_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_batches batch
    WHERE batch.id = target_batch_id
      AND (
        public.has_payroll_role(ARRAY['admin', 'hr'])
        OR (
          public.has_payroll_role(ARRAY['manager'])
          AND public.can_access_project(batch.project_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_employee_transfer_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    INSERT INTO public.employee_site_assignments (
      employee_id, site, foreman, effective_from, created_by, project_id, foreman_user_id
    )
    VALUES (
      NEW.employee_id, NEW.to_site, NEW.to_foreman, NEW.effective_on,
      auth.uid(), NEW.to_project_id, NEW.to_foreman_user_id
    );
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

REVOKE ALL ON FUNCTION public.can_access_project(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_employee(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_employee_project(BIGINT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_payroll_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_employee(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_employee_project(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_payroll_batch(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_employee_transfer_approval() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_table TEXT;
  policy_record RECORD;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users', 'projects', 'manager_project_assignments', 'employees',
    'payroll_batches', 'payroll_lines', 'timesheets', 'payroll_site_allocations',
    'advance_transactions', 'employee_salary_history', 'employee_site_assignments',
    'employee_transfer_requests', 'leave_types', 'leave_requests'
  ] LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;
    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, target_table);
    END LOOP;
  END LOOP;
END
$$;

REVOKE ALL ON public.users FROM PUBLIC, anon;
GRANT SELECT ON public.users TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.users FROM authenticated;
GRANT ALL ON public.users TO service_role;
CREATE POLICY users_select_self_admin_or_project_foreman
  ON public.users FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_payroll_role(ARRAY['admin', 'hr'])
    OR EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.foreman_user_id = users.user_id
        AND public.can_access_project(project.id)
    )
  );
CREATE POLICY users_admin_insert
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));
CREATE POLICY users_admin_update
  ON public.users FOR UPDATE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));

REVOKE ALL ON public.projects FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.projects TO authenticated;
REVOKE DELETE ON public.projects FROM authenticated;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_read_authorized
  ON public.projects FOR SELECT TO authenticated
  USING (public.can_access_project(id));
CREATE POLICY projects_admin_insert
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));
CREATE POLICY projects_admin_update
  ON public.projects FOR UPDATE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));

REVOKE ALL ON public.manager_project_assignments FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.manager_project_assignments TO authenticated;
ALTER TABLE public.manager_project_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY manager_assignments_read_self_or_admin
  ON public.manager_project_assignments FOR SELECT TO authenticated
  USING (
    manager_user_id = auth.uid()
    OR public.has_payroll_role(ARRAY['admin'])
  );
CREATE POLICY manager_assignments_admin_insert
  ON public.manager_project_assignments FOR INSERT TO authenticated
  WITH CHECK (public.has_payroll_role(ARRAY['admin']));
CREATE POLICY manager_assignments_admin_delete
  ON public.manager_project_assignments FOR DELETE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']));

REVOKE ALL ON public.employees FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
CREATE POLICY employees_read_authorized
  ON public.employees FOR SELECT TO authenticated
  USING (public.can_access_employee(id));
CREATE POLICY employees_staff_insert
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));
CREATE POLICY employees_staff_update
  ON public.employees FOR UPDATE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));
CREATE POLICY employees_manager_update_assigned
  ON public.employees FOR UPDATE TO authenticated
  USING (
    public.has_payroll_role(ARRAY['manager'])
    AND public.can_access_employee(id)
  )
  WITH CHECK (
    public.has_payroll_role(ARRAY['manager'])
    AND public.can_access_employee(id)
  );
CREATE POLICY employees_admin_delete
  ON public.employees FOR DELETE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']));

REVOKE ALL ON public.payroll_batches FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_batches TO authenticated;
CREATE POLICY payroll_batches_read_authorized
  ON public.payroll_batches FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_project(project_id)
    )
  );
CREATE POLICY payroll_batches_write_authorized
  ON public.payroll_batches FOR ALL TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_project(project_id)
    )
  )
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_project(project_id)
    )
  );

REVOKE ALL ON public.payroll_lines FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_lines TO authenticated;
CREATE POLICY payroll_lines_read_authorized
  ON public.payroll_lines FOR SELECT TO authenticated
  USING (
    public.can_access_payroll_batch(batch_id)
    AND (
      public.has_payroll_role(ARRAY['admin', 'hr'])
      OR EXISTS (
        SELECT 1 FROM public.payroll_batches batch
        WHERE batch.id = payroll_lines.batch_id
          AND public.can_access_employee_project(payroll_lines.employee_id, batch.project_id)
      )
    )
  );
CREATE POLICY payroll_lines_write_authorized
  ON public.payroll_lines FOR ALL TO authenticated
  USING (
    public.can_access_payroll_batch(batch_id)
    AND (
      public.has_payroll_role(ARRAY['admin', 'hr'])
      OR EXISTS (
        SELECT 1 FROM public.payroll_batches batch
        WHERE batch.id = payroll_lines.batch_id
          AND public.can_access_employee_project(payroll_lines.employee_id, batch.project_id)
      )
    )
  )
  WITH CHECK (
    public.can_access_payroll_batch(batch_id)
    AND (
      public.has_payroll_role(ARRAY['admin', 'hr'])
      OR EXISTS (
        SELECT 1 FROM public.payroll_batches batch
        WHERE batch.id = payroll_lines.batch_id
          AND public.can_access_employee_project(payroll_lines.employee_id, batch.project_id)
      )
    )
  );

REVOKE ALL ON public.timesheets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheets TO authenticated;
CREATE POLICY timesheets_read_authorized
  ON public.timesheets FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      project_id IS NOT NULL
      AND public.can_access_project(project_id)
      AND (
        public.has_payroll_role(ARRAY['manager'])
        OR (
          public.has_payroll_role(ARRAY['foreman'])
          AND foreman_user_id = auth.uid()
        )
      )
    )
  );
CREATE POLICY timesheets_insert_authorized
  ON public.timesheets FOR INSERT TO authenticated
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      project_id IS NOT NULL
      AND public.can_access_project(project_id)
      AND public.can_access_employee_project(employee_id, project_id)
      AND (
        public.has_payroll_role(ARRAY['manager'])
        OR (
          public.has_payroll_role(ARRAY['foreman'])
          AND foreman_user_id = auth.uid()
        )
      )
    )
  );
CREATE POLICY timesheets_update_authorized
  ON public.timesheets FOR UPDATE TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      project_id IS NOT NULL
      AND public.can_access_project(project_id)
      AND public.can_access_employee_project(employee_id, project_id)
      AND (
        public.has_payroll_role(ARRAY['manager'])
        OR (
          public.has_payroll_role(ARRAY['foreman'])
          AND foreman_user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      project_id IS NOT NULL
      AND public.can_access_project(project_id)
      AND public.can_access_employee_project(employee_id, project_id)
      AND (
        public.has_payroll_role(ARRAY['manager'])
        OR (
          public.has_payroll_role(ARRAY['foreman'])
          AND foreman_user_id = auth.uid()
        )
      )
    )
  );
CREATE POLICY timesheets_admin_delete
  ON public.timesheets FOR DELETE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']));

REVOKE ALL ON public.payroll_site_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_site_allocations TO authenticated;
GRANT ALL ON public.payroll_site_allocations TO service_role;
CREATE POLICY payroll_site_allocations_read_authorized
  ON public.payroll_site_allocations FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_project(project_id)
    )
  );

REVOKE ALL ON public.advance_transactions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advance_transactions TO authenticated;
CREATE POLICY advances_read_authorized
  ON public.advance_transactions FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (public.has_payroll_role(ARRAY['manager']) AND public.can_access_employee(employee_id))
  );
CREATE POLICY advances_write_authorized
  ON public.advance_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (public.has_payroll_role(ARRAY['manager']) AND public.can_access_employee(employee_id))
  );
CREATE POLICY advances_update_authorized
  ON public.advance_transactions FOR UPDATE TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (public.has_payroll_role(ARRAY['manager']) AND public.can_access_employee(employee_id))
  )
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (public.has_payroll_role(ARRAY['manager']) AND public.can_access_employee(employee_id))
  );
CREATE POLICY advances_admin_delete
  ON public.advance_transactions FOR DELETE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin']));

REVOKE ALL ON public.employee_salary_history FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.employee_salary_history TO authenticated;
CREATE POLICY salary_history_staff_read
  ON public.employee_salary_history FOR SELECT TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']));
CREATE POLICY salary_history_staff_insert
  ON public.employee_salary_history FOR INSERT TO authenticated
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));
REVOKE UPDATE, DELETE ON public.employee_salary_history FROM authenticated;

REVOKE ALL ON public.employee_site_assignments FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.employee_site_assignments TO authenticated;
CREATE POLICY site_assignments_read_authorized
  ON public.employee_site_assignments FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      project_id IS NOT NULL
      AND public.can_access_project(project_id)
      AND (
        public.has_payroll_role(ARRAY['manager'])
        OR foreman_user_id = auth.uid()
      )
    )
  );
CREATE POLICY site_assignments_insert_authorized
  ON public.employee_site_assignments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND project_id IS NOT NULL
      AND public.can_access_project(project_id)
      AND public.can_access_employee_project(employee_id, project_id)
      AND (
        foreman_user_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.projects project
          WHERE project.id = project_id
            AND project.foreman_user_id = foreman_user_id
        )
      )
    )
  );
REVOKE UPDATE, DELETE ON public.employee_site_assignments FROM authenticated;

REVOKE ALL ON public.employee_transfer_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.employee_transfer_requests TO authenticated;
CREATE POLICY transfer_requests_read_authorized
  ON public.employee_transfer_requests FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND (
        public.can_access_project(from_project_id)
        OR public.can_access_project(to_project_id)
      )
    )
  );
CREATE POLICY transfer_requests_manager_insert
  ON public.employee_transfer_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_employee_project(employee_id, to_project_id)
      AND to_project_id IS NOT NULL
      AND public.can_access_project(to_project_id)
    )
  );
CREATE POLICY transfer_requests_staff_update
  ON public.employee_transfer_requests FOR UPDATE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));

REVOKE ALL ON public.leave_types FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.leave_types TO authenticated;
CREATE POLICY leave_types_staff_read
  ON public.leave_types FOR SELECT TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr', 'manager']));
CREATE POLICY leave_types_staff_write
  ON public.leave_types FOR ALL TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));

REVOKE ALL ON public.leave_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.leave_requests TO authenticated;
CREATE POLICY leave_requests_read_authorized
  ON public.leave_requests FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_employee_project(employee_id, to_project_id)
    )
  );
CREATE POLICY leave_requests_insert_authorized
  ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.has_payroll_role(ARRAY['admin', 'hr'])
    OR (
      public.has_payroll_role(ARRAY['manager'])
      AND public.can_access_employee(employee_id)
    )
  );
CREATE POLICY leave_requests_staff_update
  ON public.leave_requests FOR UPDATE TO authenticated
  USING (public.has_payroll_role(ARRAY['admin', 'hr']))
  WITH CHECK (public.has_payroll_role(ARRAY['admin', 'hr']));

CREATE OR REPLACE FUNCTION public.stamp_project_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_updated_at_trg
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_updated_at();
REVOKE ALL ON FUNCTION public.stamp_project_updated_at() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_project_user_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'manager_project_assignments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE user_id = NEW.manager_user_id AND role = 'manager' AND is_active
    ) THEN
      RAISE EXCEPTION 'Only active manager accounts can be assigned to projects';
    END IF;
  ELSIF NEW.foreman_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = NEW.foreman_user_id AND role = 'foreman' AND is_active
  ) THEN
    RAISE EXCEPTION 'Only active foreman accounts can be assigned to projects';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_foreman_validate_trg
  BEFORE INSERT OR UPDATE OF foreman_user_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_user_assignments();
CREATE TRIGGER manager_project_assignment_validate_trg
  BEFORE INSERT OR UPDATE ON public.manager_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_user_assignments();
REVOKE ALL ON FUNCTION public.validate_project_user_assignments() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'projects', 'manager_project_assignments'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log()',
      target_table || '_audit_log_trg',
      target_table
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
