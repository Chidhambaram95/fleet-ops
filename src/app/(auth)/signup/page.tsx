import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Create account · Fleet Ops",
};

export default function SignupPage() {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-orange-800">
        Fleet Ops
      </p>
      <h1 className="text-2xl font-semibold leading-tight">Create account</h1>
      <p className="text-sm text-stone-600">
        Use a work email. You’ll need it on every device.
      </p>
      <AuthForm mode="signup" />
      <p className="text-center text-sm text-stone-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-orange-800">
          Sign in
        </Link>
      </p>
    </section>
  );
}
