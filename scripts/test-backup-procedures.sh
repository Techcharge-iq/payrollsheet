#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d)"
mock_dir="$test_dir/mock-bin"
backup_dir="$test_dir/backups"
mock_restore_sql="$test_dir/restore.sql"
backup_file=""
mkdir "$mock_dir" "$backup_dir"

cleanup() {
  if [[ -n "$backup_file" ]]; then
    rm -f "$backup_file" "$backup_file.sha256"
  fi
  rm -f "$mock_dir/pg_dump" "$mock_dir/pg_restore" "$mock_dir/psql" "$mock_restore_sql"
  rmdir "$backup_dir" "$mock_dir" "$test_dir"
}
trap cleanup EXIT

cat > "$mock_dir/pg_dump" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
for argument in "$@"; do
  if [[ "$argument" == --file=* ]]; then
    printf 'test archive data\n' > "${argument#--file=}"
    exit 0
  fi
done
exit 2
MOCK

cat > "$mock_dir/pg_restore" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--list" ]]; then
  [[ -s "${2:-}" ]]
  exit
fi
printf 'SELECT 42;\n'
[[ "${MOCK_FAIL_RESTORE:-0}" != "1" ]]
MOCK

cat > "$mock_dir/psql" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" --single-transaction "*) ;;
  *) exit 3 ;;
esac
cat > "$MOCK_RESTORE_SQL"
if grep -q "RAISE EXCEPTION 'Payroll archive extraction failed'" "$MOCK_RESTORE_SQL"; then
  exit 1
fi
grep -q "ALTER TABLE public.payroll_lines DISABLE TRIGGER USER;" "$MOCK_RESTORE_SQL"
grep -q "ALTER TABLE public.payroll_lines ENABLE TRIGGER USER;" "$MOCK_RESTORE_SQL"
grep -q "SELECT 42;" "$MOCK_RESTORE_SQL"
MOCK

chmod 700 "$mock_dir/pg_dump" "$mock_dir/pg_restore" "$mock_dir/psql"

PATH="$mock_dir:$PATH" DATABASE_URL="postgresql://backup-test" \
  bash "$root/scripts/backup-payroll.sh" "$backup_dir"
backup_file="$(find "$backup_dir" -maxdepth 1 -type f -name 'payroll-*.dump' -print -quit)"
[[ -n "$backup_file" && -s "$backup_file" && -s "$backup_file.sha256" ]]

if PATH="$mock_dir:$PATH" PAYROLL_RESTORE_DATABASE_URL="postgresql://restore-test" \
  MOCK_RESTORE_SQL="$mock_restore_sql" bash "$root/scripts/restore-payroll.sh" "$backup_file"; then
  printf 'Restore unexpectedly proceeded without empty-target confirmation.\n' >&2
  exit 1
fi

PATH="$mock_dir:$PATH" PAYROLL_RESTORE_DATABASE_URL="postgresql://restore-test" \
  PAYROLL_RESTORE_EMPTY_TARGET=YES MOCK_RESTORE_SQL="$mock_restore_sql" \
  bash "$root/scripts/restore-payroll.sh" "$backup_file"

if PATH="$mock_dir:$PATH" PAYROLL_RESTORE_DATABASE_URL="postgresql://restore-test" \
  PAYROLL_RESTORE_EMPTY_TARGET=YES MOCK_RESTORE_SQL="$mock_restore_sql" MOCK_FAIL_RESTORE=1 \
  bash "$root/scripts/restore-payroll.sh" "$backup_file"; then
  printf 'Restore unexpectedly succeeded after archive extraction failed.\n' >&2
  exit 1
fi

printf 'Backup/restore script checks passed.\n'
