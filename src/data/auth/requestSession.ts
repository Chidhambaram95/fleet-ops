import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { membershipForUser, SessionError, type ActiveMembership } from "@data/auth/session";
import { getCompanyProfile, getMemberModule, isSuperAdmin } from "@data/companies/repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Per-request session facts for Server Components (layout and pages).
 *
 * Each function is wrapped in React's `cache()`, so the layout and the page
 * of one request share a single Supabase client and a single answer instead
 * of asking the database again. Do not use these in Server Actions or route
 * handlers: those run their own checks on purpose.
 */

export const getRequestSupabase = cache(() => createServerSupabaseClient());

/** The signed-in user, or null. */
export const getRequestUser = cache(async (): Promise<User | null> => {
  const supabase = await getRequestSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getRequestSuperAdmin = cache(async (userId: string) =>
  isSuperAdmin(await getRequestSupabase(), userId),
);

/** The user's membership. Throws SessionError (like getActiveMembership) when there is none. */
export const getRequestMembership = cache(async (): Promise<ActiveMembership> => {
  const user = await getRequestUser();
  if (!user) {
    throw new SessionError("Sign in to save cash entries.", 401);
  }
  return membershipForUser(await getRequestSupabase(), user.id);
});

/** Like getRequestMembership, but null instead of throwing. */
export async function getRequestMembershipOrNull(): Promise<ActiveMembership | null> {
  return getRequestMembership().catch(() => null);
}

export const getRequestCompanyProfile = cache(async (organizationId: string) =>
  getCompanyProfile(await getRequestSupabase(), organizationId),
);

export const getRequestMemberModule = cache(async (organizationId: string, userId: string) =>
  getMemberModule(await getRequestSupabase(), organizationId, userId),
);
