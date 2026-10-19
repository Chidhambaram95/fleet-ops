import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in · Fleet Ops",
};

export default function LoginPage() {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-orange-800">
        Fleet Ops
      </p>
      <h1 className="text-2xl font-semibold leading-tight">Sign in</h1>
      <p className="text-sm text-stone-600">
        Log today’s collections and diesel on this phone.
      </p>
      <AuthForm mode="login" />
      <p className="text-center text-sm text-stone-600">
        New here? Ask your company admin to send you an invite on WhatsApp.
      </p>
    </section>
  );
}
