import type { SupabaseClient } from "@supabase/supabase-js";

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** Adds a login made for this company (see prepareCompanyLogin). */
export async function addMemberDirect(
  client: SupabaseClient,
  input: { organizationId: string; userId: string; role: string; busId: string | null; displayName: string },
) {
  const { error } = await client.rpc("add_member_direct", {
    p_org: input.organizationId,
    p_user: input.userId,
    p_role: input.role,
    p_bus: input.busId,
    p_name: input.displayName,
  });
  fail(error);
}

/** Admins remove managers and crew; managers remove crew. */
export async function removeCompanyMember(client: SupabaseClient, organizationId: string, userId: string) {
  const { error } = await client.rpc("remove_member", { p_org: organizationId, p_user: userId });
  fail(error);
}

export async function canSetMemberPassword(client: SupabaseClient, organizationId: string, userId: string) {
  const { data, error } = await client.rpc("can_set_member_password", {
    p_org: organizationId,
    p_user: userId,
  });
  fail(error);
  return data === true;
}

/** Each member's stored login (email, or the phone-number login). */
export async function listTeamLogins(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("team_logins", { p_org: organizationId });
  fail(error);
  return new Map(
    ((data ?? []) as { user_id: string; login: string }[]).map((row) => [row.user_id, row.login]),
  );
}
