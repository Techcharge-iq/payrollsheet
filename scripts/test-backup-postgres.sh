#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'Docker must be installed and running to execute the PostgreSQL restore drill.\n' >&2
  exit 2
fi

docker run --rm -i --user postgres -v "$root:/workspace:ro" postgres:17-alpine sh -eu <<'CONTAINER'
initdb -D /tmp/pgdata --username=postgres --auth=trust >/dev/null
pg_ctl -D /tmp/pgdata -o "-h 127.0.0.1 -p 55432" -w start >/dev/null
trap 'pg_ctl -D /tmp/pgdata -m fast stop >/dev/null' EXIT
createdb -h 127.0.0.1 -p 55432 payroll_source
createdb -h 127.0.0.1 -p 55432 payroll_target

for database in payroll_source payroll_target; do
  psql -h 127.0.0.1 -p 55432 -v ON_ERROR_STOP=1 -d "$database" <<'SQL'
CREATE TABLE public.employees (id BIGINT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE public.payroll_batches (id TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE public.payroll_lines (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES public.payroll_batches(id),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id),
  net_pay NUMERIC NOT NULL
);
CREATE TABLE public.advance_transactions (
  id TEXT PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id),
  amount NUMERIC NOT NULL
);
CREATE TABLE public.timesheets (
  id TEXT PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id),
  work_date DATE NOT NULL
);
CREATE TABLE public.payroll_site_allocations (
  id TEXT PRIMARY KEY,
  payroll_line_id TEXT NOT NULL REFERENCES public.payroll_lines(id),
  site TEXT NOT NULL
);
CREATE TABLE public.users (user_id TEXT PRIMARY KEY, role TEXT NOT NULL);
CREATE TABLE public.audit_logs (id TEXT PRIMARY KEY, event TEXT NOT NULL);
CREATE FUNCTION public.test_audit_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_logs VALUES ('audit-' || NEW.id, 'line insert');
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_line_audit AFTER INSERT ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.test_audit_line();
CREATE FUNCTION public.test_allocate_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.payroll_site_allocations VALUES ('derived-' || NEW.id, NEW.id, 'Derived');
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_line_allocate AFTER INSERT ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.test_allocate_line();
SQL
done

psql -h 127.0.0.1 -p 55432 -v ON_ERROR_STOP=1 -d payroll_source <<'SQL'
INSERT INTO public.employees VALUES (1, 'Drill employee');
INSERT INTO public.payroll_batches VALUES ('batch-1', 'DRAFT');
INSERT INTO public.payroll_lines VALUES ('line-1', 'batch-1', 1, 125.50);
INSERT INTO public.advance_transactions VALUES ('advance-1', 1, 5.25);
INSERT INTO public.timesheets VALUES ('time-1', 1, DATE '2026-10-05');
INSERT INTO public.payroll_site_allocations VALUES ('allocation-1', 'line-1', 'Main site');
INSERT INTO public.users VALUES ('auth-user-1', 'admin');
INSERT INTO public.audit_logs VALUES ('manual-audit-1', 'manual change');
SQL

DATABASE_URL=postgresql://postgres@127.0.0.1:55432/payroll_source \
  bash /workspace/scripts/backup-payroll.sh /tmp/payroll-backups
backup_file="$(find /tmp/payroll-backups -maxdepth 1 -type f -name "payroll-*.dump" -print -quit)"
PAYROLL_RESTORE_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/payroll_target \
  PAYROLL_RESTORE_EMPTY_TARGET=YES \
  bash /workspace/scripts/restore-payroll.sh "$backup_file"

counts_sql="SELECT concat_ws('|', (SELECT count(*) FROM employees), (SELECT count(*) FROM payroll_batches), (SELECT count(*) FROM payroll_lines), (SELECT count(*) FROM advance_transactions), (SELECT count(*) FROM timesheets), (SELECT count(*) FROM payroll_site_allocations), (SELECT count(*) FROM users), (SELECT count(*) FROM audit_logs))"
source_counts="$(psql -h 127.0.0.1 -p 55432 -d payroll_source -Atqc "$counts_sql")"
target_counts="$(psql -h 127.0.0.1 -p 55432 -d payroll_target -Atqc "$counts_sql")"
if [[ "$source_counts" != "$target_counts" || "$target_counts" != "1|1|1|1|1|2|1|2" ]]; then
  printf "Restore row counts do not match: source=%s target=%s\n" "$source_counts" "$target_counts" >&2
  exit 1
fi

triggers_enabled="$(psql -h 127.0.0.1 -p 55432 -d payroll_target -Atqc \
  "SELECT bool_and(tgenabled = 'O') FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'payroll_lines' AND NOT t.tgisinternal")"
if [[ "$triggers_enabled" != "t" ]]; then
  printf 'Restore did not re-enable user triggers.\n' >&2
  exit 1
fi

printf 'PostgreSQL backup/restore drill passed: rows=%s; audit/allocation triggers stayed consistent.\n' "$target_counts"
CONTAINER
