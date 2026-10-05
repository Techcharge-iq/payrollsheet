#!/usr/bin/env bash
set -euo pipefail

backup_file="${1:?Usage: bash scripts/restore-payroll.sh <backup.dump>}"
: "${PAYROLL_RESTORE_DATABASE_URL:?Set PAYROLL_RESTORE_DATABASE_URL to the empty recovery database.}"

if [[ "${PAYROLL_RESTORE_EMPTY_TARGET:-}" != "YES" ]]; then
  printf 'Refusing restore. Set PAYROLL_RESTORE_EMPTY_TARGET=YES only after verifying the target is empty and has the matching schema.\n' >&2
  exit 2
fi

if [[ ! -f "$backup_file" ]]; then
  printf 'Backup file not found: %s\n' "$backup_file" >&2
  exit 2
fi

backup_file="$(cd "$(dirname "$backup_file")" && pwd)/$(basename "$backup_file")"
if [[ -f "$backup_file.sha256" ]]; then
  (cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$backup_file").sha256")
fi
pg_restore --list "$backup_file" >/dev/null

{
  for table in employees payroll_batches payroll_lines advance_transactions timesheets payroll_site_allocations users; do
    printf 'ALTER TABLE public.%s DISABLE TRIGGER USER;\n' "$table"
  done
  if ! pg_restore --data-only --no-owner --no-acl --file=- "$backup_file"; then
    printf "DO \\$\\$ BEGIN RAISE EXCEPTION 'Payroll archive extraction failed'; END \\$\\$;\n"
    exit 1
  fi
  for table in employees payroll_batches payroll_lines advance_transactions timesheets payroll_site_allocations users; do
    printf 'ALTER TABLE public.%s ENABLE TRIGGER USER;\n' "$table"
  done
} | psql \
  --dbname="$PAYROLL_RESTORE_DATABASE_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --single-transaction

printf 'Payroll data restore completed. Verify row counts and critical reports before use.\n'
