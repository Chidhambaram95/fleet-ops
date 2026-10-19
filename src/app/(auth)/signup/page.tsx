import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Join · Fleet Ops",
};

export default function SignupPage() {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-orange-800">
        Fleet Ops
      </p>
      <h1 className="text-2xl font-semibold leading-tight">Join by invite</h1>
      <p className="text-sm text-stone-600">
        Accounts are created from an invite link. Ask your company admin to send
        you one on WhatsApp, then open it on this phone.
      </p>
      <Link href="/login" className="font-medium text-orange-800">
        Back to sign in
      </Link>
    </section>
  );
}
