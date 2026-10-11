export function projectAccessError(error: unknown, action: "load" | "save") {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const permissionDenied =
    code === "42501" ||
    /permission denied|row-level security|not authorized|insufficient privilege/i.test(message);

  if (!permissionDenied) return message;

  const actionText = action === "load" ? "loading" : "saving";
  return `Database permissions prevented the app from ${actionText} site assignments. Ask your Supabase administrator to check the database role grants and row-level security policies for projects, manager_project_assignments, and employee_site_assignments. Details: ${message}`;
}
