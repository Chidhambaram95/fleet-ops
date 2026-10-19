import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Join · Fleet Ops",
};

export default function SignupPage() {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      <h1 className="text-2xl font-extrabold leading-tight">Join by invite</h1>
      <p className="text-sm text-muted">
        Accounts are created from an invite link. Ask your company admin to send
        you one on WhatsApp, then open it on this phone.
      </p>
      <Link href="/login" className="font-medium text-brand">
        Back to sign in
      </Link>
    </section>
  );
}
