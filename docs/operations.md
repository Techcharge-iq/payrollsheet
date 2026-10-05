# Payroll data operations

## Supabase backups

Supabase is the source of truth. Dexie is a per-user browser cache, not a backup or a
write queue. App writes go to Supabase first; the cache is refreshed from Realtime changes.

Enable and monitor Supabase's managed backups/PITR for the production project. Also keep
encrypted logical backups outside this repository and outside the Supabase project. The
included scripts export the `public` schema's data, including payroll, timesheets, and audit
records; they do not export authentication users, storage objects, or project settings.

The PostgreSQL client tools (`pg_dump` and `pg_restore`) must be installed. Keep connection
strings in a secret manager or shell environment, never in source control or command history.
Use the Supabase direct database connection where available, or its session pooler for
`pg_dump`; transaction pooler connections may not support the required dump behavior.

```sh
export DATABASE_URL='postgresql://...'
bash scripts/backup-payroll.sh /secure/offsite/payroll-backups
```

The backup script uses a restrictive umask for new files and directories, writes to a
temporary file, validates the custom-format archive, atomically publishes it, and records a
SHA-256 checksum. Configure the destination for encryption at rest and apply a documented
retention policy.

## Recovery drill

Perform a recovery drill at least quarterly using an isolated Supabase branch or staging
project with the matching migrations **and matching Auth user IDs**. Keep its Auth identities
intact and empty only the `public` application tables before restoring; the data archive does
not include `auth.users`, and audit/role rows reference those IDs. Never point a recovery drill
at production.

```sh
export PAYROLL_RESTORE_DATABASE_URL='postgresql://...staging...'
export PAYROLL_RESTORE_EMPTY_TARGET=YES
bash scripts/restore-payroll.sh /secure/offsite/payroll-backups/payroll-YYYYMMDDTHHMMSSZ.dump
```

The restore script verifies the checksum (when present), validates the archive, temporarily
disables user triggers for the data load (to avoid generating duplicate audit rows or derived
allocations), and restores in one transaction so a failed restore rolls back and re-enables
triggers. Use a database owner connection with permission to change user-trigger state. In
staging, verify employee, batch, line, timesheet, advance, site-allocation, and audit row
counts; sign in as admin and HR; check payroll totals and an audit record; and save/read a test
batch. Record the date, archive checksum, migration revision, row-count comparison, and
outcome in the team's incident/recovery log.

The script deliberately requires explicit confirmation that the target is empty. Recovery
always requires an operator to confirm the target and schema before running it.

Run the local guard/transaction-wrapper checks with `npm run test:ops`. They use mocked
PostgreSQL client binaries to check archive validation, the explicit-target guard, trigger
handling, and rollback signaling. This does not replace the quarterly staging restore drill.

For an actual disposable PostgreSQL dump/restore test (Docker required), run
`npm run test:ops:postgres`. It creates an isolated temporary database, verifies row counts and
audit/allocation-trigger behavior, then removes the container.
