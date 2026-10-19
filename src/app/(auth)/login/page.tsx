import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in · Fleet Ops",
};

export default function LoginPage() {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      <h1 className="text-2xl font-extrabold leading-tight">Sign in</h1>
      <p className="text-sm text-muted">
        Write down today’s money in and money out for every bus.
      </p>
      <AuthForm mode="login" />
      <p className="text-center text-sm text-muted">
        New here? Ask your company admin to send you an invite on WhatsApp.
      </p>
    </section>
  );
}
