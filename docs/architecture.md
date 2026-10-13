# Application architecture

## Runtime architecture

```mermaid
flowchart LR
  subgraph People["Payroll users"]
    Admin["Admin"]
    HR["HR"]
    Manager["Manager"]
    Foreman["Foreman"]
  end

  subgraph Browser["Browser application"]
    Login["Sign-in and role gate"]
    Shell["TanStack Router app shell"]
    Features["Payroll feature tabs<br/>Employees · Payroll · Timesheets<br/>Advances · History · Cost Allocation"]
    Queries["React Query hooks<br/>payroll-data"]
    Cache[("Dexie per-user cache<br/>payroll-cache")]
    Exports["Client-side exports<br/>PDF · Excel · WPS"]
    AuthAttach["Attach Supabase access token<br/>to server-function requests"]
  end

  subgraph Backend["Supabase project"]
    Auth["Supabase Auth"]
    RLS["PostgREST + Row Level Security"]
    DB[("PostgreSQL<br/>employees · payroll_batches · payroll_lines<br/>timesheets · advances · projects · audit_logs")]
    Realtime["Supabase Realtime"]
  end

  subgraph Server["TanStack Start server functions"]
    AuthCheck["Validate bearer token<br/>and active user role"]
    AdminOps["Privileged account / project operations<br/>service-role client"]
    Reviews["Attendance review functions"]
  end

  AI["Vercel AI Gateway"]

  Admin --> Login
  HR --> Login
  Manager --> Login
  Foreman --> Login
  Login --> Auth
  Auth --> Login
  Login --> Shell
  Shell --> Features
  Features --> Queries
  Queries --> Cache
  Cache --> Features
  Queries -->|"Read snapshots and write payroll data<br/>with publishable key + user session"| RLS
  RLS --> DB
  DB --> RLS
  RLS -->|"Initial per-user snapshots"| Cache
  DB --> Realtime
  Realtime -->|"Changes update cache;<br/>invalidate matching queries"| Cache
  Features --> Exports
  Features --> AuthAttach
  AuthAttach --> AuthCheck
  AuthCheck -->|"User-scoped calls"| RLS
  AuthCheck --> AdminOps
  AdminOps -->|"Server-only service-role access"| DB
  AuthCheck --> Reviews
  Reviews -->|"Attendance context"| RLS
  Reviews -->|"Advisory AI review"| AI
```

## Payroll and attendance flow

```mermaid
flowchart TD
  SignIn["User signs in"] --> Role{"Active payroll role?"}
  Role -->|"No"| Denied["Show access/configuration message"]
  Role -->|"Yes"| Subscribe["Subscribe to Supabase Realtime"]
  Subscribe --> Snapshot["Fetch visible Supabase table snapshots"]
  Snapshot --> Cache[("Store rows in the signed-in user's Dexie cache")]
  Cache --> Dashboard["Render payroll dashboard and feature tabs"]

  Dashboard --> Attendance["Record daily attendance"]
  Attendance --> Timesheets["Upsert timesheets in Supabase"]
  Dashboard --> Payroll["Build or edit monthly payroll batch"]
  Payroll --> Calculate["Calculate payroll lines<br/>from employee rates, hours, advances, and deductions"]
  Calculate --> Save["Save batch and lines in Supabase"]

  Timesheets --> RLS["Supabase PostgREST + Row Level Security"]
  Save --> RLS
  RLS --> Database[("Supabase PostgreSQL")]
  Database --> Events["Realtime change events"]
  Events --> Cache
  Cache --> Refresh["Refresh affected React Query views"]
  Refresh --> Dashboard

  Dashboard --> Reports["History, cost allocation, attendance reports"]
  Dashboard --> Files["Salary slips, spreadsheets, WPS exports"]
```

## Boundaries and source of truth

- The browser uses Supabase Auth and the publishable key. Database access is constrained by
  Supabase Row Level Security; the browser does not receive a service-role key.
- Supabase PostgreSQL is the source of truth. The per-user Dexie database is a local read
  cache, populated from Supabase and kept current through Realtime; it is not a write queue
  or backup.
- Payroll data access and mutations are organized in `src/lib/payroll-data.ts`. Feature
  views are in `src/components/payroll/`.
- TanStack Start server functions receive a bearer token through the function middleware and
  validate it before running. Privileged account and project management uses a server-only
  service-role client. Attendance-review functions call the AI Gateway for advisory results.
- PDF, spreadsheet, and WPS file generation runs in the browser using the existing export
  helpers in `src/lib/`.
