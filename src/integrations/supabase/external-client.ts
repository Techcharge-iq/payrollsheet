import { createClient } from "@supabase/supabase-js";
import type { Database } from "./external-types";

// External Supabase project used by the payroll app.
// The publishable (anon) key is safe to ship in client code; access is guarded by RLS.
const EXTERNAL_SUPABASE_URL = "https://milcjipktyhlwiriujrw.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pbGNqaXBrdHlobHdpcml1anJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNzE2ODgsImV4cCI6MjEwMzc0NzY4OH0.kl4tQZKyt-41vtFYZ4hqwOIOvRnkYLnqC0KwoFE7YZk";

function create() {
  return createClient<Database>(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      experimental: { passkey: true },
    },
  });
}

let _client: ReturnType<typeof create> | undefined;

export const db = new Proxy({} as ReturnType<typeof create>, {
  get(_t, prop, receiver) {
    if (!_client) _client = create();
    return Reflect.get(_client, prop, receiver);
  },
});

/** Untyped view of the same client, for tables added outside the generated types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dbAny = db as any;
