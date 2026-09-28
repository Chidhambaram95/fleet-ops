import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAuthenticatedUserId(client: SupabaseClient) {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error) {
    throw new Error(error.message);
  }
  if (!user) {
    throw new Error("Sign in to save cash entries.");
  }

  return user.id;
}
