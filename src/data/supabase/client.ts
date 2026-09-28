import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "./env";

/**
 * Platform-agnostic Supabase client (Next.js browser + React Native).
 * Pass this client into data-layer functions. Do not import Next.js APIs here.
 */
export function createSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createClient(url, anonKey);
}
