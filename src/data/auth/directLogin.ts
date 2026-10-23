import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoginId } from "@domain/auth/loginId";

/**
 * Makes the login for someone a company is adding directly, or reuses the
 * login of a person who was removed from a company earlier. The company id is
 * stamped in app_metadata, which add_member_direct checks.
 * `service` must be the service-role client.
 */
export async function prepareCompanyLogin(
  service: SupabaseClient,
  input: { organizationId: string; login: LoginId; password: string; displayName: string },
): Promise<string> {
  const appMetadata = { fleetops_org: input.organizationId };
  const { data: lookup, error: lookupError } = await service.rpc("login_lookup", {
    p_email: input.login.email,
  });
  if (lookupError) throw new Error(lookupError.message);
  const existing = (
    lookup as { user_id: string; organization_id: string | null; super_admin: boolean }[] | null
  )?.[0];

  if (existing) {
    if (existing.organization_id || existing.super_admin) {
      throw new Error(
        input.login.kind === "phone"
          ? "This phone number already has a Fleet Ops login in a company."
          : "This email already has a Fleet Ops login in a company.",
      );
    }
    // Someone removed earlier: give them the new password and this company.
    const { error } = await service.auth.admin.updateUserById(existing.user_id, {
      password: input.password,
      app_metadata: appMetadata,
      user_metadata: { display_name: input.displayName },
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return existing.user_id;
  }

  const { data, error } = await service.auth.admin.createUser({
    email: input.login.email,
    password: input.password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: { display_name: input.displayName },
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not make the login.");
  return data.user.id;
}

/** Sets a new password. Callers check can_set_member_password first. */
export async function setLoginPassword(service: SupabaseClient, userId: string, password: string) {
  const { error } = await service.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(error.message);
}
