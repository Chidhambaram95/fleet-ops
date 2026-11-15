import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUserRole, type UserRole } from "@domain/rbac/roles";

/** Any 8-4-4-4-12 hex id. Hand-seeded ids are not always RFC variant UUIDs. */
const ORGANIZATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrganizationId(value: string) {
  return ORGANIZATION_ID.test(value);
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export async function getAuthenticatedUserId(client: SupabaseClient) {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error) {
    throw new SessionError(error.message, 401);
  }
  if (!user) {
    throw new SessionError("Sign in to save cash entries.", 401);
  }

  return user.id;
}

export type ActiveMembership = {
  userId: string;
  organizationId: string;
  role: UserRole;
};

type MembershipRow = {
  organization_id: string;
  role: string;
};

async function loadMembership(client: SupabaseClient, userId: string) {
  return client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
}

function membershipFromRow(
  userId: string,
  row: MembershipRow | null,
): ActiveMembership | null {
  const organizationId = row?.organization_id;
  const role = typeof row?.role === "string" ? normalizeUserRole(row.role) : null;
  if (typeof organizationId === "string" && isOrganizationId(organizationId) && role) {
    return { userId, organizationId, role };
  }
  return null;
}

/** First organization the user joined, plus their role. Membership is the source of truth. */
export async function getActiveMembership(
  client: SupabaseClient,
): Promise<ActiveMembership> {
  const userId = await getAuthenticatedUserId(client);
  const { data, error } = await loadMembership(client, userId);

  if (error) {
    throw new SessionError(error.message, 403);
  }

  const membership = membershipFromRow(userId, data as MembershipRow | null);
  if (membership) {
    return membership;
  }

  throw new SessionError(
    "You are not part of a company. Ask your company admin for a new invite link.",
    403,
  );
}

export async function requireOrganizationMember(
  client: SupabaseClient,
  organizationId: string,
) {
  const userId = await getAuthenticatedUserId(client);
  if (!isOrganizationId(organizationId)) {
    throw new SessionError("Choose an organization.", 403);
  }

  const { data, error } = await client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new SessionError(error.message, 403);
  }
  if (!data) {
    throw new SessionError("You are not a member of this organization.", 403);
  }

  return organizationId;
}
