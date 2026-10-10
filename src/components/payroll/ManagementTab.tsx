import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, UserRound, X } from "lucide-react";
import { dbAny } from "@/integrations/supabase/external-client";
import { useActiveForemen, useManagedUsers, useProjects } from "@/lib/management-data";
import type { ManagedUser, Project } from "@/lib/management-data";
import { saveManagedProject, saveManagedUser } from "@/lib/management.functions";
import { btnOutline, btnPrimary, card, input, select, th } from "./ui";

type Role = ManagedUser["role"];

interface UserDraft {
  userId: string | null;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  projectIds: string[];
  foremanProjectId: string;
}

interface ProjectDraft {
  projectId: string | null;
  name: string;
  code: string;
  location: string;
  notes: string;
  active: boolean;
  foremanUserId: string;
}

const blankUser: UserDraft = {
  userId: null,
  email: "",
  fullName: "",
  role: "hr",
  isActive: true,
  projectIds: [],
  foremanProjectId: "",
};

const blankProject: ProjectDraft = {
  projectId: null,
  name: "",
  code: "",
  location: "",
  notes: "",
  active: true,
  foremanUserId: "",
};

const roleLabels: Record<Role, string> = {
  admin: "Admin",
  hr: "HR",
  manager: "Manager",
  foreman: "Foreman",
};

function labelUser(user: ManagedUser) {
  return user.full_name?.trim() || user.email || "Unnamed account";
}

function displayError(error: unknown) {
  return error instanceof Error ? error.message : "The change could not be saved.";
}

export function ManagementTab({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [userDraft, setUserDraft] = useState<UserDraft>(blankUser);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(blankProject);
  const [userMessage, setUserMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [projectMessage, setProjectMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const usersQuery = useManagedUsers();
  const projectsQuery = useProjects(true);
  const foremenQuery = useActiveForemen();
  const managerProjectsQuery = useQuery({
    queryKey: ["management", "manager-project-assignments"],
    queryFn: async (): Promise<Array<{ manager_user_id: string; project_id: string }>> => {
      const { data, error } = await dbAny
        .from("manager_project_assignments")
        .select("manager_user_id,project_id");
      if (error) throw error;
      return (data ?? []) as Array<{ manager_user_id: string; project_id: string }>;
    },
  });

  const saveUser = useMutation({
    mutationFn: () =>
      saveManagedUser({
        data: {
          ...(userDraft.userId ? { userId: userDraft.userId } : {}),
          email: userDraft.email,
          fullName: userDraft.fullName,
          role: userDraft.role,
          isActive: userDraft.isActive,
          projectIds: userDraft.projectIds,
          foremanProjectId: userDraft.foremanProjectId || null,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["management", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["management", "active-foremen"] }),
        queryClient.invalidateQueries({ queryKey: ["management", "manager-project-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      setUserMessage({
        text: userDraft.userId ? "User account updated." : "Invitation sent and account created.",
        error: false,
      });
      setUserDraft(blankUser);
    },
    onError: (error) => setUserMessage({ text: displayError(error), error: true }),
  });

  const saveProject = useMutation({
    mutationFn: () =>
      saveManagedProject({
        data: {
          projectId: projectDraft.projectId,
          name: projectDraft.name,
          code: projectDraft.code,
          location: projectDraft.location,
          notes: projectDraft.notes,
          active: projectDraft.active,
          foremanUserId: projectDraft.foremanUserId || null,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["management", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["management", "active-foremen"] }),
      ]);
      setProjectMessage({
        text: projectDraft.projectId ? "Project updated." : "Project created.",
        error: false,
      });
      setProjectDraft(blankProject);
    },
    onError: (error) => setProjectMessage({ text: displayError(error), error: true }),
  });

  const users = usersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const activeForemen = foremenQuery.data ?? [];
  const managersProjects = managerProjectsQuery.data ?? [];
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter(
      (user) =>
        !query ||
        [user.full_name, user.email, user.role].some((value) =>
          value?.toLowerCase().includes(query),
        ),
    );
  }, [users, userSearch]);
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return projects.filter(
      (project) =>
        !query ||
        [project.name, project.code, project.location].some((value) =>
          value?.toLowerCase().includes(query),
        ),
    );
  }, [projects, projectSearch]);

  const editUser = (user: ManagedUser) => {
    setUserMessage(null);
    setUserDraft({
      userId: user.user_id,
      email: user.email ?? "",
      fullName: user.full_name ?? "",
      role: user.role,
      isActive: user.is_active,
      projectIds: managersProjects
        .filter((assignment) => assignment.manager_user_id === user.user_id)
        .map((assignment) => assignment.project_id),
      foremanProjectId:
        projects.find((project) => project.foreman_user_id === user.user_id)?.id ?? "",
    });
  };

  const editProject = (project: Project) => {
    setProjectMessage(null);
    setProjectDraft({
      projectId: project.id,
      name: project.name,
      code: project.code ?? "",
      location: project.location ?? "",
      notes: project.notes ?? "",
      active: project.active,
      foremanUserId: project.foreman_user_id ?? "",
    });
  };

  const requestError =
    usersQuery.error ??
    projectsQuery.error ??
    foremenQuery.error ??
    managerProjectsQuery.error;

  return (
    <div className="space-y-4">
      {requestError && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          Could not load management data: {displayError(requestError)}
        </p>
      )}

      <section className={`${card} space-y-4 p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-navy">
              <UserRound size={18} /> User accounts
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Invitations are sent securely; passwords are set by the invited user.
            </p>
          </div>
          {userDraft.userId && (
            <button type="button" className={btnOutline} onClick={() => setUserDraft(blankUser)}>
              <X size={14} /> Cancel edit
            </button>
          )}
        </div>

        <form
          className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            setUserMessage(null);
            saveUser.mutate();
          }}
        >
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Full name
            <input
              required
              maxLength={120}
              className={input}
              value={userDraft.fullName}
              onChange={(event) => setUserDraft({ ...userDraft, fullName: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Email address
            <input
              required
              type="email"
              maxLength={254}
              className={input}
              value={userDraft.email}
              disabled={Boolean(userDraft.userId)}
              onChange={(event) => setUserDraft({ ...userDraft, email: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Role
            <select
              className={select}
              value={userDraft.role}
              onChange={(event) => {
                const role = event.target.value as Role;
                setUserDraft({
                  ...userDraft,
                  role,
                  projectIds: role === "manager" ? userDraft.projectIds : [],
                  foremanProjectId: role === "foreman" ? userDraft.foremanProjectId : "",
                });
              }}
            >
              {(["admin", "hr", "manager", "foreman"] as const).map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </label>
          {userDraft.role === "manager" && (
            <fieldset className="space-y-1 text-xs font-semibold text-slate-600 sm:col-span-2">
              <legend>Assigned projects</legend>
              <div className="max-h-24 space-y-1 overflow-auto rounded-lg border border-slate-300 bg-card p-2">
                {projects.filter((project) => project.active).map((project) => (
                  <label key={project.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={userDraft.projectIds.includes(project.id)}
                      onChange={(event) =>
                        setUserDraft({
                          ...userDraft,
                          projectIds: event.target.checked
                            ? [...userDraft.projectIds, project.id]
                            : userDraft.projectIds.filter((id) => id !== project.id),
                        })
                      }
                    />
                    {project.name}
                  </label>
                ))}
                {!projects.some((project) => project.active) && (
                  <span className="font-normal text-muted-foreground">Create an active project first.</span>
                )}
              </div>
            </fieldset>
          )}
          {userDraft.role === "foreman" && (
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Assigned project
              <select
                className={select}
                required
                value={userDraft.foremanProjectId}
                onChange={(event) =>
                  setUserDraft({ ...userDraft, foremanProjectId: event.target.value })
                }
              >
                <option value="">Choose project</option>
                {projects
                  .filter(
                    (project) =>
                      project.active &&
                      (!project.foreman_user_id || project.foreman_user_id === userDraft.userId),
                  )
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={userDraft.isActive}
              onChange={(event) => setUserDraft({ ...userDraft, isActive: event.target.checked })}
            />
            Active account
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className={btnPrimary}
              disabled={saveUser.isPending || !projectsQuery.isSuccess || !foremenQuery.isSuccess}
            >
              <Check size={15} />
              {saveUser.isPending
                ? "Saving…"
                : userDraft.userId
                  ? "Save user"
                  : "Invite user"}
            </button>
          </div>
        </form>
        {userMessage && (
          <p
            role={userMessage.error ? "alert" : "status"}
            className={`text-sm ${userMessage.error ? "text-danger" : "text-emerald-700"}`}
          >
            {userMessage.text}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-navy">Accounts ({filteredUsers.length})</h3>
          <input
            aria-label="Search users"
            className={`${input} max-w-xs`}
            placeholder="Search name, email, or role"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={th}>Role</th>
                <th className={th}>Status</th>
                <th className={th}>Assignments</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const userProjects = projects.filter(
                  (project) =>
                    project.foreman_user_id === user.user_id ||
                    managersProjects.some(
                      (assignment) =>
                        assignment.manager_user_id === user.user_id &&
                        assignment.project_id === project.id,
                    ),
                );
                return (
                  <tr key={user.user_id} className="border-b border-border/70">
                    <td className="px-3 py-2 font-semibold text-slate-700">
                      {labelUser(user)}
                      {user.user_id === currentUserId && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{user.email ?? "—"}</td>
                    <td className="px-3 py-2">{roleLabels[user.role]}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                          user.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-xs text-slate-600">
                      {userProjects.map((project) => project.name).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className={btnOutline}
                        onClick={() => editUser(user)}
                        aria-label={`Edit ${labelUser(user)}`}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filteredUsers.length && (
                <tr>
                  <td colSpan={6} className="p-5 text-center text-sm text-muted-foreground">
                    No matching accounts.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} space-y-4 p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-extrabold text-navy">Projects & sites</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Deactivation keeps project links and historical attendance/payroll intact.
            </p>
          </div>
          {projectDraft.projectId && (
            <button type="button" className={btnOutline} onClick={() => setProjectDraft(blankProject)}>
              <X size={14} /> Cancel edit
            </button>
          )}
        </div>
        <form
          className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            setProjectMessage(null);
            saveProject.mutate();
          }}
        >
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Project name
            <input
              required
              maxLength={160}
              className={input}
              value={projectDraft.name}
              onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Site code
            <input
              maxLength={40}
              className={input}
              value={projectDraft.code}
              onChange={(event) => setProjectDraft({ ...projectDraft, code: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Foreman
            <select
              className={select}
              value={projectDraft.foremanUserId}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, foremanUserId: event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {activeForemen.map((foreman) => (
                <option key={foreman.user_id} value={foreman.user_id}>
                  {labelUser(foreman)}
                </option>
              ))}
              {users
                .filter(
                  (user) =>
                    user.role === "foreman" &&
                    user.user_id === projectDraft.foremanUserId &&
                    !user.is_active,
                )
                .map((foreman) => (
                  <option key={foreman.user_id} value={foreman.user_id}>
                    {labelUser(foreman)} (inactive, historical)
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Location
            <input
              maxLength={200}
              className={input}
              value={projectDraft.location}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, location: event.target.value })
              }
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 sm:col-span-2">
            Notes
            <input
              maxLength={2000}
              className={input}
              value={projectDraft.notes}
              onChange={(event) => setProjectDraft({ ...projectDraft, notes: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={projectDraft.active}
              onChange={(event) => setProjectDraft({ ...projectDraft, active: event.target.checked })}
            />
            Active project
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary} disabled={saveProject.isPending}>
              <Plus size={15} />
              {saveProject.isPending
                ? "Saving…"
                : projectDraft.projectId
                  ? "Save project"
                  : "Create project"}
            </button>
          </div>
        </form>
        {projectMessage && (
          <p
            role={projectMessage.error ? "alert" : "status"}
            className={`text-sm ${projectMessage.error ? "text-danger" : "text-emerald-700"}`}
          >
            {projectMessage.text}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-navy">Projects ({filteredProjects.length})</h3>
          <input
            aria-label="Search projects"
            className={`${input} max-w-xs`}
            placeholder="Search name, code, or location"
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Project</th>
                <th className={th}>Code</th>
                <th className={th}>Foreman</th>
                <th className={th}>Status</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => {
                const assignedForeman = users.find(
                  (user) => user.user_id === project.foreman_user_id,
                );
                return (
                  <tr key={project.id} className="border-b border-border/70">
                    <td className="px-3 py-2 font-semibold text-slate-700">
                      {project.name}
                      {project.location && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {project.location}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{project.code || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {assignedForeman
                        ? `${labelUser(assignedForeman)}${assignedForeman.is_active ? "" : " (inactive)"}`
                        : "Unassigned"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                          project.active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {project.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className={btnOutline}
                        onClick={() => editProject(project)}
                        aria-label={`Edit ${project.name}`}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filteredProjects.length && (
                <tr>
                  <td colSpan={5} className="p-5 text-center text-sm text-muted-foreground">
                    No matching projects.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
