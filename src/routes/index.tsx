import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart2,
  CheckCircle2,
  ClipboardList,
  FileDown,
  History,
  Save,
  Users,
  Banknote,
  AlertTriangle,
  CalendarDays,
  Clock3,
  KeyRound,
  LogOut,
  Plus,
  Search,
  Menu,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";

import { LoginPage } from "@/components/payroll/LoginPage";
const EmployeesTab = lazy(() =>
  import("@/components/payroll/EmployeesTab").then((module) => ({
    default: module.EmployeesTab,
  })),
);
const PayrollTab = lazy(() =>
  import("@/components/payroll/PayrollTab").then((module) => ({ default: module.PayrollTab })),
);
const HistoryTab = lazy(() =>
  import("@/components/payroll/HistoryTab").then((module) => ({ default: module.HistoryTab })),
);
const SlipsTab = lazy(() =>
  import("@/components/payroll/SlipsTab").then((module) => ({ default: module.SlipsTab })),
);
const CostTab = lazy(() =>
  import("@/components/payroll/CostTab").then((module) => ({ default: module.CostTab })),
);
const AdvancesTab = lazy(() =>
  import("@/components/payroll/AdvancesTab").then((module) => ({ default: module.AdvancesTab })),
);
const AuditHistoryTab = lazy(() =>
  import("@/components/payroll/AuditHistoryTab").then((module) => ({
    default: module.AuditHistoryTab,
  })),
);
const TimesheetsTab = lazy(() =>
  import("@/components/payroll/TimesheetsTab").then((module) => ({
    default: module.TimesheetsTab,
  })),
);
const AttendanceReportTab = lazy(() =>
  import("@/components/payroll/AttendanceReportTab").then((module) => ({
    default: module.AttendanceReportTab,
  })),
);
import {
  EmployeeModal,
  type EmployeeForm,
  type ModalMode,
} from "@/components/payroll/EmployeeModal";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
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
  useUpdateBatchStatus,
} from "@/lib/payroll-data";
import type {
  AdvanceTx,
  Employee,
  EmployeeStatus,
  PayrollBatch,
  PayrollBatchStatus,
} from "@/lib/payroll";
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const attendanceDirtyRef = useRef(false);
  const activeTab = TABS.find((item) => item.id === tab);

  const employeesQuery = useEmployees();
  const needsPayrollHistory = ["history", "slips", "advances"].includes(tab) || mode !== null;
  const batchesQuery = useBatches(undefined, needsPayrollHistory);
  const saveEmployee = useSaveEmployee();
  const canDelete = role === "admin";
  const saveBatch = useSaveBatch(canDelete);
  const updateBatchStatus = useUpdateBatchStatus();
  const deleteBatch = useDeleteBatch();
  const advancesQuery = useAdvances();
  const saveTimesheets = useSaveTimesheets();
  const saveAdvance = useSaveAdvance();
  const deleteAdvance = useDeleteAdvance();

  const employees: Employee[] = employeesQuery.data ?? [];
  const batches: PayrollBatch[] = batchesQuery.data ?? [];
  const advances: AdvanceTx[] = advancesQuery.data ?? [];

  const notify = (msg: string, tone: "ok" | "warn" = "ok") => setToast({ msg, tone });
  const navigateToTab = useCallback(
    (nextTab: TabId) => {
      if (
        tab === "timesheets" &&
        nextTab !== tab &&
        attendanceDirtyRef.current &&
        !window.confirm("Discard unsaved attendance changes?")
      ) {
        return;
      }
      attendanceDirtyRef.current = false;
      setTab(nextTab);
    },
    [tab],
  );

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

  const error = employeesQuery.error ?? batchesQuery.error ?? advancesQuery.error;
  const commandActions = useMemo(
    () => [
      {
        id: "new-employee",
        label: "New employee",
        description: "Create a new worker profile",
        shortcut: "N",
        action: () => {
          setForm(emptyForm);
          setMode("new");
          navigateToTab("employees");
        },
      },
      {
        id: "employees",
        label: "Open employees",
        description: "Review the employee master list",
        shortcut: "E",
        action: () => navigateToTab("employees"),
      },
      {
        id: "payroll",
        label: "Open payroll",
        description: "Manage monthly payroll batches",
        shortcut: "P",
        action: () => navigateToTab("payroll"),
      },
      {
        id: "timesheets",
        label: "Open timesheets",
        description: "Review daily attendance entries",
        shortcut: "T",
        action: () => navigateToTab("timesheets"),
      },
      {
        id: "attendance",
        label: "Open attendance report",
        description: "View labor and attendance metrics",
        shortcut: "A",
        action: () => navigateToTab("attendance"),
      },
      {
        id: "advances",
        label: "Open advances",
        description: "Track outstanding employee advances",
        shortcut: "V",
        action: () => navigateToTab("advances"),
      },
      {
        id: "history",
        label: "Open history",
        description: "See employee payroll history and balances",
        shortcut: "H",
        action: () => navigateToTab("history"),
      },
      {
        id: "slips",
        label: "Open salary slips",
        description: "Generate and download payslips",
        shortcut: "S",
        action: () => navigateToTab("slips"),
      },
      {
        id: "cost",
        label: "Open cost allocation",
        description: "Review labour and site cost reporting",
        shortcut: "C",
        action: () => navigateToTab("cost"),
      },
      ...(canDelete
        ? [
            {
              id: "audit",
              label: "Open audit log",
              description: "Review payroll changes and transactions",
              shortcut: "L",
              action: () => navigateToTab("audit"),
            },
          ]
        : []),
    ],
    [canDelete, navigateToTab],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="workstation-shell min-h-screen bg-canvas font-sans text-foreground">
      <nav
        id="application-menu"
        className={`floating-menu ${mobileMenuOpen ? "is-open" : ""}`}
        aria-label="Application menu"
      >
        <button
          type="button"
          className="floating-menu-trigger"
          aria-controls="application-menu-links"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
          <span>{mobileMenuOpen ? "Close menu" : `Menu · ${activeTab?.label ?? "Navigate"}`}</span>
        </button>
        <div id="application-menu-links" className="floating-menu-links">
          {TABS.filter((item) => !("adminOnly" in item) || canDelete).map(
            ({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={(event) => {
                  navigateToTab(id);
                  setMobileMenuOpen(false);
                  if (event.detail > 0) event.currentTarget.blur();
                }}
                aria-label={label}
                aria-current={tab === id ? "page" : undefined}
                title={label}
                className={`floating-menu-button ${tab === id ? "is-active" : ""}`}
              >
                <Icon size={19} strokeWidth={tab === id ? 2.5 : 2} />
                <span className="floating-menu-mobile-label">{label}</span>
                <span className="floating-menu-tooltip">{label}</span>
              </button>
            ),
          )}
        </div>
        <div className="floating-menu-tools">
          <button
            type="button"
            onClick={(event) => {
              setMobileMenuOpen(false);
              setCommandOpen(true);
              if (event.detail > 0) event.currentTarget.blur();
            }}
            aria-label="Search and commands"
            title="Search / commands (Ctrl+K)"
            className="floating-menu-button"
          >
            <Search size={18} />
            <span className="floating-menu-mobile-label">Search / commands</span>
            <span className="floating-menu-tooltip">Search / commands</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              setMobileMenuOpen(false);
              if (event.detail > 0) event.currentTarget.blur();
              void addPasskey();
            }}
            disabled={registeringPasskey}
            aria-label="Add passkey"
            title={registeringPasskey ? "Adding passkey…" : "Add passkey"}
            className="floating-menu-button"
          >
            <KeyRound size={18} />
            <span className="floating-menu-mobile-label">Add passkey</span>
            <span className="floating-menu-tooltip">
              {registeringPasskey ? "Adding passkey…" : "Add passkey"}
            </span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              setMobileMenuOpen(false);
              if (event.detail > 0) event.currentTarget.blur();
              void db.auth.signOut();
            }}
            aria-label={`Sign out ${email}`}
            title={`Sign out ${email}`}
            className="floating-menu-button floating-menu-signout"
          >
            <LogOut size={18} />
            <span className="floating-menu-mobile-label">Sign out</span>
            <span className="floating-menu-tooltip">Sign out · {role}</span>
          </button>
        </div>
      </nav>
      <div className="workstation-content min-w-0">
        {error && (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            <AlertTriangle size={15} /> {(error as Error).message}
          </p>
        )}

        <Suspense
          fallback={
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm font-medium text-muted-foreground">
              Loading section…
            </div>
          }
        >
          <main key={tab} className="mobile-screen-enter">
            {tab === "timesheets" && (
              <TimesheetsTab
                employees={employees}
                saving={saveTimesheets.isPending}
                onSave={(rows) => saveTimesheets.mutateAsync(rows)}
                notify={notify}
                onDirtyChange={(dirty) => {
                  attendanceDirtyRef.current = dirty;
                }}
              />
            )}
            {tab === "attendance" && <AttendanceReportTab employees={employees} />}
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
                advances={advances}
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
                onStatus={(id: string, status: PayrollBatchStatus) =>
                  updateBatchStatus.mutateAsync({ id, status })
                }
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
            {tab === "slips" && (
              <SlipsTab employees={employees} batches={batches} notify={notify} />
            )}
            {tab === "cost" && <CostTab employees={employees} notify={notify} />}
            {tab === "audit" && canDelete && <AuditHistoryTab />}
          </main>
        </Suspense>

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

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Type a command or section name…" />
        <CommandList>
          <CommandEmpty>No command matches your search.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {commandActions.map(({ id, label, description, shortcut, action }) => (
              <CommandItem
                key={id}
                value={`${label} ${description}`}
                onSelect={() => {
                  action();
                  setCommandOpen(false);
                }}
              >
                <Search size={14} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <CommandShortcut>{shortcut}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

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
