import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roles = ["admin", "hr", "manager", "foreman"] as const;

const saveUserInput = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(roles),
  isActive: z.boolean(),
  projectIds: z.array(z.string().uuid()).max(100),
  foremanProjectId: z.string().uuid().nullable(),
});

const saveProjectInput = z.object({
  projectId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(40).nullable(),
  location: z.string().trim().max(200).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  active: z.boolean(),
  foremanUserId: z.string().uuid().nullable(),
});

async function assertAdmin(context: {
  userId: string;
  supabase: {
    from: (table: "users") => {
      select: (columns: string) => {
        eq: (column: "user_id", value: string) => {
          maybeSingle: () => Promise<{
            data: { role: string; is_active: boolean } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
}) {
  const { data, error } = await context.supabase
    .from("users")
    .select("role,is_active")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(`Could not verify administrator access: ${error.message}`);
  if (data?.role !== "admin" || !data.is_active) {
    throw new Error("Only an active administrator can manage accounts and projects.");
  }
}

async function writeAudit(
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  context: { userId: string; claims: Record<string, unknown> },
  tableName: string,
  recordId: string,
  operation: "INSERT" | "UPDATE",
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown>,
) {
  const { error } = await admin.from("audit_logs").insert({
    table_name: tableName,
    record_id: recordId,
    operation,
    actor_id: context.userId,
    actor_email: typeof context.claims["email"] === "string" ? context.claims["email"] : null,
    old_data: oldData,
    new_data: newData,
  });
  if (error) throw new Error(`The change was saved but its audit record failed: ${error.message}`);
}

export const saveManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => saveUserInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const input = data;

    if (input.role === "manager" && input.projectIds.length === 0) {
      throw new Error("Assign a manager to at least one active project.");
    }
    if (input.role !== "manager" && input.projectIds.length > 0) {
      throw new Error("Only managers can have manager project assignments.");
    }
    if (input.role === "foreman" && !input.foremanProjectId) {
      throw new Error("Assign a foreman to a project.");
    }
    if (input.role !== "foreman" && input.foremanProjectId) {
      throw new Error("Only foremen can be assigned as project foremen.");
    }
    if (!input.isActive && input.role === "admin" && input.userId) {
      const { count, error } = await supabaseAdmin
        .from("users")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);
      if (error) throw new Error(`Could not check active administrators: ${error.message}`);
      if ((count ?? 0) <= 1) throw new Error("The last active administrator cannot be deactivated.");
    }
    if (
      input.userId === context.userId &&
      (!input.isActive || input.role !== "admin")
    ) {
      throw new Error("You cannot deactivate or change your own administrator role.");
    }

    const { data: projects, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("id,active,foreman_user_id");
    if (projectError) throw new Error(`Could not validate project assignments: ${projectError.message}`);
    const activeProjects = new Map(
      (projects ?? []).filter((project) => project.active).map((project) => [project.id, project]),
    );
    if (input.projectIds.some((projectId) => !activeProjects.has(projectId))) {
      throw new Error("Manager assignments must use active projects.");
    }
    if (input.foremanProjectId && !activeProjects.has(input.foremanProjectId)) {
      throw new Error("Foremen can only be assigned to an active project.");
    }

    let managedUserId = input.userId;
    let previousProfile: Record<string, unknown> | null = null;
    if (managedUserId) {
      const { data: existing, error } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("user_id", managedUserId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the user profile: ${error.message}`);
      if (!existing) throw new Error("The selected user profile no longer exists.");
      previousProfile = existing as Record<string, unknown>;
    } else {
      const { data: existing, error } = await supabaseAdmin
        .from("users")
        .select("user_id")
        .ilike("email", input.email)
        .maybeSingle();
      if (error) throw new Error(`Could not check for duplicate email: ${error.message}`);
      if (existing) throw new Error("A user profile already exists for this email address.");

      const { data: invitation, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
          data: { full_name: input.fullName },
        });
      if (inviteError) throw new Error(`Could not send the secure invitation: ${inviteError.message}`);
      if (!invitation.user) throw new Error("Supabase did not return the invited account.");
      managedUserId = invitation.user.id;
    }

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      managedUserId,
      {
        user_metadata: { full_name: input.fullName },
        ban_duration: input.isActive ? "none" : "876000h",
      },
    );
    if (authError) throw new Error(`Could not update the authentication account: ${authError.message}`);
    if (!authUser.user) throw new Error("Supabase did not return the updated authentication account.");

    const { error: profileError } = await supabaseAdmin.from("users").upsert(
      {
        user_id: managedUserId,
        email: input.email,
        full_name: input.fullName,
        role: input.role,
        is_active: input.isActive,
      },
      { onConflict: "user_id" },
    );
    if (profileError) {
      if (!input.userId) {
        const { error: cleanupError } =
          await supabaseAdmin.auth.admin.deleteUser(managedUserId);
        if (cleanupError) {
          throw new Error(
            `Could not save the profile (${profileError.message}) or remove the incomplete invitation (${cleanupError.message}).`,
          );
        }
      }
      throw new Error(`Could not save the user profile: ${profileError.message}`);
    }

    const { error: managerDeleteError } = await supabaseAdmin
      .from("manager_project_assignments")
      .delete()
      .eq("manager_user_id", managedUserId);
    if (managerDeleteError) {
      throw new Error(`Profile saved, but manager assignments could not be updated: ${managerDeleteError.message}`);
    }
    if (input.role === "manager" && input.isActive) {
      const { error } = await supabaseAdmin.from("manager_project_assignments").insert(
        input.projectIds.map((projectId) => ({
          manager_user_id: managedUserId,
          project_id: projectId,
          assigned_by: context.userId,
        })),
      );
      if (error) throw new Error(`Profile saved, but manager assignments could not be updated: ${error.message}`);
    }

    const oldForemanProjects = (projects ?? []).filter(
      (project) => project.foreman_user_id === managedUserId,
    );
    for (const project of oldForemanProjects) {
      if (project.id === input.foremanProjectId && input.role === "foreman" && input.isActive) {
        continue;
      }
      const { error } = await supabaseAdmin
        .from("projects")
        .update({ foreman_user_id: null })
        .eq("id", project.id);
      if (error) throw new Error(`Profile saved, but the previous foreman assignment could not be removed: ${error.message}`);
    }
    if (input.role === "foreman" && input.isActive && input.foremanProjectId) {
      const { error } = await supabaseAdmin
        .from("projects")
        .update({ foreman_user_id: managedUserId })
        .eq("id", input.foremanProjectId);
      if (error) throw new Error(`Profile saved, but the project foreman could not be assigned: ${error.message}`);
    }

    await writeAudit(
      supabaseAdmin,
      context,
      "users",
      managedUserId,
      input.userId ? "UPDATE" : "INSERT",
      previousProfile,
      {
        email: input.email,
        full_name: input.fullName,
        role: input.role,
        is_active: input.isActive,
        manager_project_ids: input.role === "manager" && input.isActive ? input.projectIds : [],
        foreman_project_id:
          input.role === "foreman" && input.isActive ? input.foremanProjectId : null,
      },
    );
    return { userId: managedUserId };
  });

export const saveManagedProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => saveProjectInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.foremanUserId) {
      const { data: foreman, error } = await supabaseAdmin
        .from("users")
        .select("role,is_active")
        .eq("user_id", data.foremanUserId)
        .maybeSingle();
      if (error) throw new Error(`Could not validate the selected foreman: ${error.message}`);
      if (foreman?.role !== "foreman" || !foreman.is_active) {
        throw new Error("Choose an active foreman account.");
      }
    }
    const { data: names, error: nameError } = await supabaseAdmin
      .from("projects")
      .select("id,name");
    if (nameError) throw new Error(`Could not check for duplicate project names: ${nameError.message}`);
    if (
      (names ?? []).some(
        (project) =>
          project.id !== data.projectId &&
          project.name.trim().toLowerCase() === data.name.toLowerCase(),
      )
    ) {
      throw new Error("A project with this name already exists.");
    }

    const projectValues = {
      name: data.name,
      code: data.code || null,
      location: data.location || null,
      notes: data.notes || null,
      active: data.active,
      foreman_user_id: data.foremanUserId,
    };
    const query = data.projectId
      ? supabaseAdmin.from("projects").update(projectValues).eq("id", data.projectId).select("*").single()
      : supabaseAdmin.from("projects").insert(projectValues).select("*").single();
    const { data: project, error } = await query;
    if (error) throw new Error(`Could not save the project: ${error.message}`);
    await writeAudit(
      supabaseAdmin,
      context,
      "projects",
      project.id,
      data.projectId ? "UPDATE" : "INSERT",
      null,
      project as Record<string, unknown>,
    );
    return project;
  });
