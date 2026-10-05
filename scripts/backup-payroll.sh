#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?Set DATABASE_URL to the source Supabase PostgreSQL connection string.}"

backup_dir="${1:-./backups}"
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/payroll-$timestamp.dump"
temporary_file="$backup_file.partial"
trap 'rm -f "$temporary_file"' EXIT

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --data-only \
  --schema=public \
  --no-owner \
  --no-acl \
  --file="$temporary_file"

pg_restore --list "$temporary_file" >/dev/null
mv "$temporary_file" "$backup_file"
(cd "$backup_dir" && sha256sum "$(basename "$backup_file")" > "$(basename "$backup_file").sha256")

printf 'Verified payroll data backup: %s\n' "$backup_file"
