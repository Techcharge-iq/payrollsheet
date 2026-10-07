# Payroll Companion

Analyse my old simple app and create smae like that with wonderful ideas and theme should be same like that elegant and all the buttons should visible clearly. And Make mentioned these changes:

Employees: Employee master fields must be { id, name, trade, idNumber, salary/hr, status }, where status = Active / Holiday / Cancelled. Edit must use the same fields.

Monthly Payroll: The hard-hat button must allow changing the foreman for individual employees/lines, not only the whole batch.

Prevent duplicate payroll: For the selected month, once an employee is added to one payroll batch, automatically exclude/block that employee from all other batches for the same month. This must prevent accidental double salary payment.

Employee History: Selecting an employee must show month-by-month hours, salary/hr, gross salary, food deduction, previous/outstanding advance, new advance, other deductions, paid amount and remaining balance.

Salary Slips: Allow selecting one or multiple employees and generate/download individual salary slips as PDF.

Employee Details: Clicking View on an employee should immediately open a modal showing complete monthly payroll history and totals: hours, salary, food, advance, deductions, paid and outstanding balance.

Advance carry-forward: Automatically carry each employee's unpaid/outstanding advance from the previous month into the next month's advance/deduction calculation. Never lose or duplicate the balance.

Supabase: Replace browser/session/local persistence with Supabase database storage. Preserve existing data structure where practical and use proper relational tables for employees, payroll batches and payroll lines.

Monthly Payroll: Admins can edit batches in any status while lifecycle metadata remains protected. Daily Timesheets: Attendance can be edited by date or entered for one employee across a month; days without a selected status remain unrecorded.

Important: modify the existing application only, preserve the current layout/theme, calculations and Cost Allocation functionality. Do not remove existing working features. Make the smallest clean changes necessary and ensure existing payroll data is not lost.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://payrollsheet.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d2cf1806-a43a-473e-8851-0180d7f23309).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npx playwright install chromium
npm run test:e2e
npm run dev
```

## Supabase sign-in and payroll roles

The app uses Supabase email/password authentication. Create or invite each user from **Supabase Dashboard → Authentication → Users**; public sign-up is not needed. In the SQL Editor for the same Supabase project that stores the payroll tables, run the SQL in [`supabase/migrations/20260926000000_payroll_auth_roles.sql`](./supabase/migrations/20260926000000_payroll_auth_roles.sql). It preserves existing payroll rows, replaces public table policies, and enables role-based access.

After creating the accounts, assign one `admin` and each HR user in the SQL Editor (replace the example addresses):

```sql
INSERT INTO public.users (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'admin@company.com'
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.users (user_id, role)
SELECT id, 'hr' FROM auth.users WHERE email = 'hr@company.com'
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
```

Admins can read, create, edit, and delete payroll records. HR can read, create, and edit employee, payroll, and advance records, but cannot delete rows; delete controls are hidden in the HR interface and Supabase RLS also blocks direct delete requests. Users without either role cannot access payroll data. Role changes are managed by an administrator in the SQL Editor.

## Daily timesheets and attendance reports

Payroll uses the existing `employees`, `payroll_batches`, and `payroll_lines` tables. Daily attendance is stored separately in `public.timesheets`, linked to an employee, with a site and foreman name, work date, in/out times, and break duration. `total_hours` is a generated database column, so saved hours are derived from the recorded shift rather than accepted from the browser. Site names remain on each timesheet entry; a separate site directory is not required.

Apply [`supabase/migrations/20261003175100_timesheets.sql`](./supabase/migrations/20261003175100_timesheets.sql), [`supabase/migrations/20261004000000_phase3_payroll_integrity.sql`](./supabase/migrations/20261004000000_phase3_payroll_integrity.sql), then [`supabase/migrations/20261005000000_local_first_cache_realtime.sql`](./supabase/migrations/20261005000000_local_first_cache_realtime.sql) after the existing payroll role and audit log migrations. The migrations add authenticated `admin`/`hr` row-level access, daily-entry uniqueness, shift validation, payroll lifecycle protection, and the Realtime publication required to keep the browser's per-user Dexie cache current. No Edge Function is needed: writes go to Supabase first, and RLS remains authoritative.

## Local cache and backup/recovery

Employees, payroll, advances, timesheets, and site allocations are read from a user-scoped Dexie cache after one initial Supabase refresh. Changes made by any authorized client flow through Supabase Realtime and update the local cache; writes are sent to Supabase first, and the cache is updated from the successful response. The admin audit viewer remains paginated from Supabase and is not mirrored locally. The cache is not a backup and is scoped/cleared on sign out.

Follow [`docs/operations.md`](./docs/operations.md) to configure managed backups, create encrypted logical data backups, and run a recovery drill against a matching staging project.

Run `npm run test:ops` to validate backup/restore script guardrails using mocked PostgreSQL tools. This does not replace the staging restore drill.
