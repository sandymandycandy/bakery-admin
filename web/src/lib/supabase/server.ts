import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

// Per-request client acting as the signed-in staff member; RLS applies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}

// Bypasses RLS. Only for Auth admin operations (creating staff logins, resetting passwords)
// after the caller has been verified as an admin.
export function createAdminClient() {
  if (!env.supabaseSecretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Add it to web/.env.local to manage staff logins.",
    );
  }
  return createSupabaseClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
