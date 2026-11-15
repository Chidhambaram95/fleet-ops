"use server";

import { getInvite } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { passwordProblem } from "@domain/auth/loginId";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Makes the login for someone holding a valid invite link. Logins are made
 * here on the server, so public sign-up can stay switched off in Supabase:
 * without an open invite nobody can create an account.
 */
export async function createInviteLoginAction(input: {
  token: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ error?: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { error: "Enter your name." };
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  const weak = passwordProblem(input.password);
  if (weak) return { error: weak };
  if (!hasPublicSupabaseEnv()) return { error: "Fleet Ops is not set up yet." };

  const invite = await getInvite(await createServerSupabaseClient(), input.token);
  if (!invite.valid) return { error: invite.reason };

  let service;
  try {
    service = createServiceSupabaseClient();
  } catch {
    return { error: "Joining by invite is not set up yet. Please contact Fleet Ops." };
  }
  const { error } = await service.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      return { error: "An account with that email already exists. Choose “I already have a login”." };
    }
    return { error: error.message };
  }
  return {};
}
