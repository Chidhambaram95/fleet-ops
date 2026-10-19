import type { Metadata } from "next";
import Link from "next/link";
import { getInvite } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { InviteForm } from "@/components/auth/InviteForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join your company · Fleet Ops",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = hasPublicSupabaseEnv()
    ? await getInvite(await createServerSupabaseClient(), token)
    : ({ valid: false, reason: "Fleet Ops is not set up yet." } as const);

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      {invite.valid ? (
        <>
          <h1 className="text-2xl font-extrabold leading-tight">Join {invite.company}</h1>
          <p className="text-sm text-muted">
            You are invited as {invite.role === "crew" ? "crew" : invite.role}. Create your
            password to get started.
          </p>
          <InviteForm token={token} initialName={invite.displayName} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-extrabold leading-tight">Invite not available</h1>
          <p className="text-sm text-muted">{invite.reason}</p>
          <p className="text-sm text-muted">Ask your company admin to send a new invite.</p>
          <Link href="/login" className="font-medium text-brand">
            Go to sign in
          </Link>
        </>
      )}
    </section>
  );
}
