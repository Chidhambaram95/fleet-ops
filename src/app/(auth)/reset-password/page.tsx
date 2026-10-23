import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/PasswordReset";

export const metadata: Metadata = {
  title: "New password · Fleet Ops",
};

export default function ResetPasswordPage() {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      <h1 className="text-2xl font-extrabold leading-tight">Set a new password</h1>
      <ResetPasswordForm />
    </section>
  );
}
