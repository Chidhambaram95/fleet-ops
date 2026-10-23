import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@data/supabase/env";

/**
 * Service-role client for making and changing logins. Server actions only:
 * the key bypasses every database rule, so it must never reach the browser.
 */
export function createServiceSupabaseClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "Adding people directly needs SUPABASE_SERVICE_ROLE_KEY in the server settings. Use an invite for now.",
    );
  }
  const { url } = getPublicSupabaseEnv();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
