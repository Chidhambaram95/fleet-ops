import type { SupabaseClient } from "@supabase/supabase-js";

export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }
}

export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
) {
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function signOut(client: SupabaseClient) {
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}
