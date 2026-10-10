import { useQuery } from "@tanstack/react-query";
import { dbAny } from "@/integrations/supabase/external-client";

export interface ManagedUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "hr" | "manager" | "foreman";
  is_active: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  notes: string | null;
  active: boolean;
  foreman_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useManagedUsers(enabled = true) {
  return useQuery({
    queryKey: ["management", "users"],
    enabled,
    queryFn: async (): Promise<ManagedUser[]> => {
      const { data, error } = await dbAny
        .from("users")
        .select("user_id,email,full_name,role,is_active,created_at")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ManagedUser[];
    },
    staleTime: 30_000,
  });
}

export function useProjects(includeInactive = false) {
  return useQuery({
    queryKey: ["projects", includeInactive ? "all" : "active"],
    queryFn: async (): Promise<Project[]> => {
      let query = dbAny.from("projects").select("*").order("name", { ascending: true });
      if (!includeInactive) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Project[];
    },
    staleTime: 30_000,
  });
}

export function useActiveForemen() {
  return useQuery({
    queryKey: ["management", "active-foremen"],
    queryFn: async (): Promise<ManagedUser[]> => {
      const { data, error } = await dbAny
        .from("users")
        .select("user_id,email,full_name,role,is_active,created_at")
        .eq("role", "foreman")
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ManagedUser[];
    },
    staleTime: 30_000,
  });
}
