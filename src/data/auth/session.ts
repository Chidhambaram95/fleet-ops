import type { SupabaseClient } from "@supabase/supabase-js";

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

/** First organization the user joined. Membership is the source of truth. */
export async function getActiveOrganizationId(client: SupabaseClient) {
  const userId = await getAuthenticatedUserId(client);
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  console.log("[session] auth.uid()", userId);
  console.log("[session] organization membership", { data, error });

  if (error) {
    throw new SessionError(error.message, 403);
  }

  const organizationId = data?.organization_id;
  if (typeof organizationId === "string" && isOrganizationId(organizationId)) {
    return organizationId;
  }

  if (process.env.NODE_ENV === "development") {
    const ensured = await ensureDevOrganization(client, userId);
    if (ensured) {
      return ensured;
    }
  }

  throw new SessionError(
    `You are not a member of an organization. No organization_members row is visible for ${userId}.`,
    403,
  );
}

async function ensureDevOrganization(client: SupabaseClient, userId: string) {
  const { data, error } = await client.rpc("ensure_personal_organization");
  console.log("[session] dev membership fallback", { userId, data, error });
  if (error || typeof data !== "string" || !isOrganizationId(data)) {
    return null;
  }
  return data;
}

export async function requireOrganizationMember(
  client: SupabaseClient,
  organizationId: string,
) {
  const userId = await getAuthenticatedUserId(client);
  console.log("[session] require membership", { userId, organizationId });

  if (!isOrganizationId(organizationId)) {
    throw new SessionError("Choose an organization.", 403);
  }

  const { data, error } = await client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  console.log("[session] membership check", { userId, data, error });

  if (error) {
    throw new SessionError(error.message, 403);
  }
  if (!data) {
    throw new SessionError("You are not a member of this organization.", 403);
  }

  return organizationId;
}
