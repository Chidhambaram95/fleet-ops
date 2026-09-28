"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@data/supabase/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/** Next.js browser client (cookie session). React Native should use @data/supabase/client. */
export function createBrowserSupabaseClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getPublicSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
