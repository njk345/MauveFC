import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { configured, supabaseUrl, publishableKey } from "./config";
let client: SupabaseClient | undefined;
export function getBrowserClient(): SupabaseClient {
  if (!configured) throw new Error("Club sign-in is not connected yet.");
  return (client ??= createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl:
        typeof window !== "undefined" &&
        window.location.pathname.replace(/\/$/, "") === "/login",
      storageKey: "mauve-fc-auth",
    },
  }));
}
