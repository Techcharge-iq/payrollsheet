DO $$
DECLARE
  target_table TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'The supabase_realtime publication is required for the local payroll cache';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'employees',
    'payroll_batches',
    'payroll_lines',
    'advance_transactions',
    'timesheets',
    'payroll_site_allocations'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'Required payroll table public.% does not exist', target_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        target_table
      );
    END IF;
  END LOOP;
END;
$$;
