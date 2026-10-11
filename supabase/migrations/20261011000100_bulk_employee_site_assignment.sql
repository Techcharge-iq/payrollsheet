CREATE OR REPLACE FUNCTION public.assign_employees_to_project(
  target_project_id UUID,
  target_employee_ids BIGINT[],
  target_effective_on DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_project public.projects%ROWTYPE;
  current_assignment public.employee_site_assignments%ROWTYPE;
  selected_employee_id BIGINT;
  selected_foreman TEXT;
  has_current_assignment BOOLEAN;
  assigned_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_payroll_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only an active administrator can assign employees directly.';
  END IF;

  IF target_effective_on IS NULL
     OR target_employee_ids IS NULL
     OR cardinality(target_employee_ids) = 0
     OR cardinality(target_employee_ids) > 500 THEN
    RAISE EXCEPTION 'Choose a valid effective date and between 1 and 500 employees.';
  END IF;

  IF cardinality(target_employee_ids) <> (
    SELECT count(DISTINCT selected.id)
    FROM unnest(target_employee_ids) AS selected(id)
  ) THEN
    RAISE EXCEPTION 'An employee can only be selected once.';
  END IF;

  SELECT *
    INTO selected_project
    FROM public.projects
   WHERE id = target_project_id
     AND active
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active site.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(target_employee_ids) AS selected(id)
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.employees employee
        WHERE employee.id = selected.id
          AND employee.status = 'Active'
     )
  ) THEN
    RAISE EXCEPTION 'All selected employees must exist and be active.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.employee_transfer_requests transfer
     WHERE transfer.employee_id = ANY(target_employee_ids)
       AND transfer.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'Resolve pending transfer requests before bulk-assigning these employees.';
  END IF;

  SELECT COALESCE(user_profile.full_name, '')
    INTO selected_foreman
    FROM (SELECT selected_project.foreman_user_id AS user_id) AS project_foreman
    LEFT JOIN public.users user_profile ON user_profile.user_id = project_foreman.user_id;

  FOR selected_employee_id IN
    SELECT selected.id
      FROM unnest(target_employee_ids) AS selected(id)
     ORDER BY selected.id
  LOOP
    SELECT *
      INTO current_assignment
      FROM public.employee_site_assignments assignment
     WHERE assignment.employee_id = selected_employee_id
       AND assignment.effective_to IS NULL
     FOR UPDATE;
    has_current_assignment := FOUND;

    IF has_current_assignment
       AND current_assignment.effective_from <= target_effective_on
       AND current_assignment.project_id IS NOT DISTINCT FROM selected_project.id
       AND current_assignment.site = selected_project.name
       AND current_assignment.foreman_user_id IS NOT DISTINCT FROM selected_project.foreman_user_id
       AND current_assignment.foreman = selected_foreman THEN
      CONTINUE;
    END IF;

    IF has_current_assignment
       AND current_assignment.effective_from >= target_effective_on THEN
      RAISE EXCEPTION
        'The effective date must be after the current assignment start for employee %.',
        selected_employee_id;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.employee_site_assignments assignment
       WHERE assignment.employee_id = selected_employee_id
         AND assignment.effective_to IS NOT NULL
         AND assignment.effective_from <= target_effective_on
         AND assignment.effective_to >= target_effective_on
    ) OR EXISTS (
      SELECT 1
        FROM public.employee_site_assignments assignment
       WHERE assignment.employee_id = selected_employee_id
         AND assignment.effective_from >= target_effective_on
         AND (assignment.effective_to IS NULL OR assignment.effective_to >= target_effective_on)
    ) THEN
      RAISE EXCEPTION
        'The effective date conflicts with an existing site assignment for employee %.',
        selected_employee_id;
    END IF;

    IF has_current_assignment THEN
      UPDATE public.employee_site_assignments
         SET effective_to = target_effective_on - 1
       WHERE id = current_assignment.id;
    END IF;

    INSERT INTO public.employee_site_assignments (
      employee_id,
      site,
      foreman,
      project_id,
      foreman_user_id,
      effective_from,
      created_by
    )
    VALUES (
      selected_employee_id,
      selected_project.name,
      selected_foreman,
      selected_project.id,
      selected_project.foreman_user_id,
      target_effective_on,
      auth.uid()
    );
    assigned_count := assigned_count + 1;
  END LOOP;

  RETURN assigned_count;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_employees_to_project(UUID, BIGINT[], DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_employees_to_project(UUID, BIGINT[], DATE)
  TO authenticated;
