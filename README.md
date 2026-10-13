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

**Live app**: <https://payrollsheet.lovable.app>

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

In-app user and project management uses server-side Supabase admin operations. Configure `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` as a server-only environment secret with the service-role key for the payroll Supabase project (`milcjipktyhlwiriujrw.supabase.co`). Do not expose this key through a `VITE_` variable or in client code.

Managers, HR, and administrators can review saved daily attendance with AI for missing active-employee records and unusual hour totals. Configure `AI_GATEWAY_API_KEY` as a server-only secret; optionally set `AI_GATEWAY_MODEL` (default: `openai/gpt-4o-mini`). The review sends employee names, IDs, attendance status, and hour totals for the selected date to Vercel AI Gateway. Results are advisory and must be checked before payroll is processed.

Foremen can also run an AI punch check for their assigned project and a selected date. It compares the assigned roster with saved attendance, checks punches and employee notes for missing or inconsistent clock times, and may suggest corrected times when the saved note supports them. The review sends employee names, assignment and punch data, and attendance notes to Vercel AI Gateway. Suggestions are advisory, must be reviewed, and are only written after the foreman applies them in the timesheet editor and saves the entries. The attendance dialog shows the assigned-employee count and links to Workforce & Leave when no employees are assigned.

## Daily timesheets and attendance reports

Payroll uses the existing `employees`, `payroll_batches`, and `payroll_lines` tables. Daily attendance is stored separately in `public.timesheets`, linked to an employee, with a site and foreman name, work date, in/out times, and break duration. `total_hours` is a generated database column, so saved hours are derived from the recorded shift rather than accepted from the browser. Timesheets retain the site and foreman recorded for each shift, while active projects provide reusable site choices and employee site assignments keep effective-dated deployment history.

Apply [`supabase/migrations/20261003175100_timesheets.sql`](./supabase/migrations/20261003175100_timesheets.sql), [`supabase/migrations/20261004000000_phase3_payroll_integrity.sql`](./supabase/migrations/20261004000000_phase3_payroll_integrity.sql), [`supabase/migrations/20261005000000_local_first_cache_realtime.sql`](./supabase/migrations/20261005000000_local_first_cache_realtime.sql), and [`supabase/migrations/20261006000000_admin_payroll_batch_edit_override.sql`](./supabase/migrations/20261006000000_admin_payroll_batch_edit_override.sql) after the existing payroll role and audit log migrations. Then apply [`supabase/migrations/20261008000000_remove_payroll_lock_action.sql`](./supabase/migrations/20261008000000_remove_payroll_lock_action.sql) and [`supabase/migrations/20261009000000_workforce_and_leave_foundation.sql`](./supabase/migrations/20261009000000_workforce_and_leave_foundation.sql), and [`supabase/migrations/20261010000000_payroll_overtime_settings.sql`](./supabase/migrations/20261010000000_payroll_overtime_settings.sql). The workforce migration records existing hourly rates as known only from its application date; it does not infer earlier salary history or rewrite payroll or attendance rows. Test all migrations on a database copy/backup before production. The migrations add authenticated `admin`/`hr` row-level access, daily-entry uniqueness, shift validation, payroll lifecycle protection, and the Realtime publication required to keep the browser's per-user Dexie cache current. No Edge Function is needed: writes go to Supabase first, and RLS remains authoritative.

For project-based site selection and manager access, apply [`supabase/migrations/20261010000200_management_projects_roles.sql`](./supabase/migrations/20261010000200_management_projects_roles.sql). Apply [`supabase/migrations/20261011000100_bulk_employee_site_assignment.sql`](./supabase/migrations/20261011000100_bulk_employee_site_assignment.sql) after it to enable administrators to move multiple active employees to a site on an effective date while retaining each employee's previous assignment history.

The **WPS Export** tab lets an administrator map a selected approved batch to the bank's uploaded CSV header and download a reviewed file. No default bank-specific SIF columns or employee bank details are invented; supply the employer/bank identifiers and use the bank's current template. The EOSG scenario panel is a non-persistent review estimate only and does not approve or post a settlement. The current official Oman Ministry of Labour sources are the [WPS FAQ and SIF filename requirements](https://mol.gov.om/WpsFAQ?AspxAutoDetectCookieSupport=1) and the [Oman Labour Law](https://mol.gov.om/Laborlaw?lid=6).

## Local cache and backup/recovery

Employees, payroll, advances, timesheets, and site allocations are read from a user-scoped Dexie cache after one initial Supabase refresh. Changes made by any authorized client flow through Supabase Realtime and update the local cache; writes are sent to Supabase first, and the cache is updated from the successful response. The admin audit viewer remains paginated from Supabase and is not mirrored locally. The cache is not a backup and is scoped/cleared on sign out.

Follow [`docs/operations.md`](./docs/operations.md) to configure managed backups, create encrypted logical data backups, and run a recovery drill against a matching staging project.

Run `npm run test:ops` to validate backup/restore script guardrails using mocked PostgreSQL tools. This does not replace the staging restore drill.
