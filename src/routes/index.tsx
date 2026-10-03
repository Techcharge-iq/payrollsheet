import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart2,
  CheckCircle2,
  ClipboardList,
  FileDown,
  HardHat,
  History,
  Save,
  Users,
  Banknote,
  AlertTriangle,
  CalendarDays,
  Clock3,
  Home,
  KeyRound,
  LogOut,
  Plus,
  ReceiptText,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";

import { LoginPage } from "@/components/payroll/LoginPage";
import { EmployeesTab } from "@/components/payroll/EmployeesTab";
import { PayrollTab } from "@/components/payroll/PayrollTab";
import { HistoryTab } from "@/components/payroll/HistoryTab";
import { SlipsTab } from "@/components/payroll/SlipsTab";
import { CostTab } from "@/components/payroll/CostTab";
import { AdvancesTab } from "@/components/payroll/AdvancesTab";
import { AuditHistoryTab } from "@/components/payroll/AuditHistoryTab";
import { TimesheetsTab } from "@/components/payroll/TimesheetsTab";
import { AttendanceReportTab } from "@/components/payroll/AttendanceReportTab";
import {
  EmployeeModal,
  type EmployeeForm,
  type ModalMode,
} from "@/components/payroll/EmployeeModal";
import {
  useBatches,
  useDeleteBatch,
  useEmployees,
  useSaveBatch,
  useSaveEmployee,
  useAdvances,
  useSaveAdvance,
  useDeleteAdvance,
  useSaveTimesheets,
  useTimesheets,
} from "@/lib/payroll-data";
import type { AdvanceTx, Employee, EmployeeStatus, PayrollBatch } from "@/lib/payroll";
import { db } from "@/integrations/supabase/external-client";

const TITLE = "Site Payroll Manager — Wages, Advances & Salary Slips";
const DESCRIPTION =
  "Manage site workers, monthly payroll batches, advance carry-forward, cost allocation and downloadable PDF salary slips in one elegant dashboard.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthGate,
});

const TABS = [
  { id: "employees", label: "Employees", icon: Users },
  { id: "payroll", label: "Monthly Payroll", icon: Save },
  { id: "timesheets", label: "Daily Timesheets", icon: Clock3 },
  { id: "attendance", label: "Attendance Report", icon: CalendarDays },
  { id: "advances", label: "Advances", icon: Banknote },
  { id: "history", label: "Employee History", icon: History },
  { id: "slips", label: "Salary Slips", icon: FileDown },
  { id: "cost", label: "Cost Allocation", icon: BarChart2 },
  { id: "audit", label: "Audit Log", icon: ClipboardList, adminOnly: true },
] as const;

type TabId = (typeof TABS)[number]["id"];

const emptyForm: EmployeeForm = {
  name: "",
  trade: "HELPER",
  id_number: "",
  hourly_rate: "",
  status: "Active",
};

function AuthGate() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState("");
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const { data: listener } = db.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    void db.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setRoleError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (currentUserId.current !== userId) {
      queryClient.clear();
      currentUserId.current = userId;
    }

    if (!userId) {
      setRole(null);
      setRoleError("");
      setRoleLoading(false);
      return;
    }

    let active = true;
    setRole(null);
    setRoleError("");
    setRoleLoading(true);
    void db
      .from("users")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setRole(data?.role ?? null);
        setRoleError(error?.message ?? "");
        setRoleLoading(false);
      });

    return () => {
      active = false;
    };
  }, [queryClient, userId]);

  if (authLoading || (userId && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm font-semibold text-muted-foreground">
        Checking secure access…
      </div>
    );
  }

  if (!session) return <LoginPage />;

  if (roleError || (role !== "admin" && role !== "hr")) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 text-center shadow-lg">
          <h1 className="font-display text-xl font-extrabold text-navy">Access not configured</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {roleError
              ? `We could not verify your payroll role: ${roleError}`
              : "Your account does not have an Admin or HR role. Ask your payroll administrator to assign access."}
          </p>
          <button
            onClick={() => void db.auth.signOut()}
            className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-dark"
          >
            <LogOut size={15} /> Sign out
          </button>
        </section>
      </main>
    );
  }

  return <Dashboard role={role} email={session.user.email ?? ""} />;
}

function Dashboard({ role, email }: { role: "admin" | "hr" | string; email: string }) {
  const [tab, setTab] = useState<TabId>("employees");
  const [mode, setMode] = useState<ModalMode>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "warn" } | null>(null);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);

  const employeesQuery = useEmployees();
  const batchesQuery = useBatches();
  const saveEmployee = useSaveEmployee();
  const canDelete = role === "admin";
  const saveBatch = useSaveBatch(canDelete);
  const deleteBatch = useDeleteBatch();
  const advancesQuery = useAdvances();
  const timesheetsQuery = useTimesheets();
  const saveTimesheets = useSaveTimesheets();
  const saveAdvance = useSaveAdvance();
  const deleteAdvance = useDeleteAdvance();

  const employees: Employee[] = employeesQuery.data ?? [];
  const batches: PayrollBatch[] = batchesQuery.data ?? [];
  const advances: AdvanceTx[] = advancesQuery.data ?? [];
  const timesheets = timesheetsQuery.data ?? [];

  const notify = (msg: string, tone: "ok" | "warn" = "ok") => setToast({ msg, tone });

  const addPasskey = async () => {
    setRegisteringPasskey(true);
    try {
      const { error } = await db.auth.registerPasskey();
      if (error) {
        notify(`Could not add passkey: ${error.message}`, "warn");
      } else {
        notify("Passkey added. You can now use it to sign in.");
      }
    } catch (error) {
      notify(
        `Could not add passkey: ${error instanceof Error ? error.message : "Please try again."}`,
        "warn",
      );
    } finally {
      setRegisteringPasskey(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const openFor = (employee: Employee, next: ModalMode) => {
    setForm({
      id: employee.id,
      name: employee.name,
      trade: employee.trade,
      id_number: employee.id_number,
      hourly_rate: employee.hourly_rate,
      status: employee.status,
    });
    setMode(next);
  };

  const submitEmployee = () => {
    if (!form.name.trim()) {
      notify("Employee name is required.", "warn");
      return;
    }
    saveEmployee.mutate(
      {
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        trade: form.trade,
        id_number: form.id_number,
        hourly_rate: Number(form.hourly_rate) || 0,
        status: form.status,
      },
      {
        onSuccess: () => {
          notify(`${form.name.trim()} ${form.id ? "updated" : "added"}.`);
          setMode(null);
        },
        onError: (e) => notify((e as Error).message, "warn"),
      },
    );
  };

  const error =
    employeesQuery.error ?? batchesQuery.error ?? advancesQuery.error ?? timesheetsQuery.error;
  const mobileTabs: Array<{
    id: TabId | "home";
    label: string;
    icon: typeof Home;
    adminOnly?: boolean;
  }> = [
    { id: "home", label: "Home", icon: Home },
    { id: "employees", label: "Employees", icon: Users },
    { id: "payroll", label: "Payroll", icon: Save },
    { id: "timesheets", label: "Timesheets", icon: Clock3 },
    { id: "attendance", label: "Attendance", icon: CalendarDays },
    { id: "advances", label: "Advances", icon: Banknote },
    { id: "cost", label: "Costs", icon: BarChart2 },
    { id: "audit", label: "Audit", icon: ClipboardList, adminOnly: true },
  ];
  const showHome = tab === "history" || tab === "slips";

  return (
    <div className="mobile-app-shell min-h-screen bg-canvas font-sans text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <header className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-navy shadow-sm">
                <HardHat size={23} className="text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-xl font-extrabold tracking-tight text-navy sm:text-2xl">
                  Site Payroll Manager
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  Payroll operations, organized and secure.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-navy-soft px-3 py-2 sm:flex-none">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card font-display text-sm font-bold uppercase text-navy shadow-sm">
                  {email.slice(0, 1) || role.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <p className="max-w-52 truncate text-xs font-bold text-navy">{email}</p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {role} access
                  </p>
                </div>
              </div>
              <button
                onClick={() => void addPasskey()}
                disabled={registeringPasskey}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-navy transition hover:border-navy/20 hover:bg-navy-soft disabled:cursor-wait disabled:opacity-60"
                aria-label="Add passkey"
                title="Add passkey"
              >
                <KeyRound size={15} />
                <span>{registeringPasskey ? "Adding…" : "Add passkey"}</span>
              </button>
              <button
                onClick={() => void db.auth.signOut()}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-navy transition hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={15} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </header>

        <nav className="mobile-desktop-tabs mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm">
          {TABS.filter((item) => !("adminOnly" in item) || canDelete).map(
            ({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                  tab === id
                    ? "bg-navy text-primary-foreground shadow-sm"
                    : "text-slate-600 hover:bg-navy-soft hover:text-navy"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ),
          )}
        </nav>

        <nav className="mobile-bottom-tabs" aria-label="Primary navigation">
          {mobileTabs
            .filter((item) => !item.adminOnly || canDelete)
            .map(({ id, label, icon: Icon }) => {
              const active = id === "home" ? showHome : tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id === "home" ? "history" : id)}
                  aria-current={active ? "page" : undefined}
                  className={`mobile-bottom-tab ${active ? "is-active" : ""}`}
                >
                  <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                  <span>{label}</span>
                </button>
              );
            })}
        </nav>

        {error && (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            <AlertTriangle size={15} /> {(error as Error).message}
          </p>
        )}

        {tab === "timesheets" && (
          <TimesheetsTab
            employees={employees}
            timesheets={timesheets}
            loading={employeesQuery.isLoading}
            error={timesheetsQuery.error instanceof Error ? timesheetsQuery.error.message : ""}
            saving={saveTimesheets.isPending}
            onSave={(rows) => saveTimesheets.mutateAsync(rows)}
            notify={notify}
          />
        )}

        {tab === "attendance" && (
          <AttendanceReportTab
            employees={employees}
            timesheets={timesheets}
            loading={employeesQuery.isLoading || timesheetsQuery.isLoading}
            error={timesheetsQuery.error instanceof Error ? timesheetsQuery.error.message : ""}
          />
        )}

        {showHome && (
          <div
            className="mb-4 inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm"
            aria-label="History and salary slips"
          >
            <button
              type="button"
              onClick={() => setTab("history")}
              aria-current={tab === "history" ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                tab === "history"
                  ? "bg-navy text-white shadow-sm"
                  : "text-muted-foreground hover:bg-navy-soft hover:text-navy"
              }`}
            >
              <History size={17} /> History
            </button>
            <button
              type="button"
              onClick={() => setTab("slips")}
              aria-current={tab === "slips" ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                tab === "slips"
                  ? "bg-navy text-white shadow-sm"
                  : "text-muted-foreground hover:bg-navy-soft hover:text-navy"
              }`}
            >
              <ReceiptText size={17} /> Salary slips
            </button>
          </div>
        )}

        <main key={tab} className="mobile-screen-enter">
          {tab === "employees" && (
            <EmployeesTab
              employees={employees}
              batches={batches}
              loading={employeesQuery.isLoading}
              onNew={() => {
                setForm(emptyForm);
                setMode("new");
              }}
              onView={(e) => openFor(e, "view")}
              onEdit={(e) => openFor(e, "edit")}
            />
          )}

          {tab === "payroll" && (
            <PayrollTab
              employees={employees}
              batches={batches}
              advances={advances}
              timesheets={timesheets}
              timesheetsLoading={timesheetsQuery.isLoading}
              timesheetsError={
                timesheetsQuery.error instanceof Error ? timesheetsQuery.error.message : ""
              }
              saving={saveBatch.isPending}
              canDelete={canDelete}
              notify={notify}
              onNewEmployee={() => {
                setForm(emptyForm);
                setMode("new");
              }}
              onSave={async (batch) => {
                await saveBatch.mutateAsync(batch);
                notify("Payroll batch saved.");
              }}
              onDelete={(id) =>
                deleteBatch.mutate(id, {
                  onSuccess: () => notify("Payroll batch deleted."),
                  onError: (e) => notify((e as Error).message, "warn"),
                })
              }
            />
          )}

          {tab === "advances" && (
            <AdvancesTab
              employees={employees}
              batches={batches}
              advances={advances}
              saving={saveAdvance.isPending}
              canDelete={canDelete}
              notify={notify}
              onSave={(tx, done) =>
                saveAdvance.mutate(tx, {
                  onSuccess: () => {
                    notify("Advance saved.");
                    done();
                  },
                  onError: (e) => notify((e as Error).message, "warn"),
                })
              }
              onDelete={(id) =>
                deleteAdvance.mutate(id, {
                  onSuccess: () => notify("Advance deleted."),
                  onError: (e) => notify((e as Error).message, "warn"),
                })
              }
            />
          )}
          {tab === "history" && (
            <HistoryTab employees={employees} batches={batches} advances={advances} />
          )}
          {tab === "slips" && <SlipsTab employees={employees} batches={batches} notify={notify} />}
          {tab === "cost" && <CostTab batches={batches} employees={employees} notify={notify} />}
          {tab === "audit" && canDelete && <AuditHistoryTab />}
        </main>

        {tab === "employees" && (
          <button
            onClick={() => {
              setForm(emptyForm);
              setMode("new");
            }}
            className="mobile-fab"
            aria-label="New employee"
          >
            <Plus size={24} />
          </button>
        )}
      </div>

      <EmployeeModal
        mode={mode}
        form={form}
        batches={batches}
        onChange={(field, value) => setForm((f) => ({ ...f, [field]: value as EmployeeStatus }))}
        onClose={() => setMode(null)}
        onSubmit={submitEmployee}
        onSwitchToEdit={() => setMode("edit")}
      />

      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg sm:bottom-5 ${
            toast.tone === "warn" ? "bg-danger" : "bg-money"
          }`}
        >
          {toast.tone === "warn" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
