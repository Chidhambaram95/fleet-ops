import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/PasswordReset";

export const metadata: Metadata = {
  title: "Forgot password · Fleet Ops",
};

export default function ForgotPasswordPage() {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      <h1 className="text-2xl font-extrabold leading-tight">Forgot password</h1>
      <ForgotPasswordForm />
    </section>
  );
}
