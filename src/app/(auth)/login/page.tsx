import type { Metadata } from "next";
import { FLEETOPS_ENQUIRY, FLEETOPS_WHATSAPP } from "@domain/platform/contact";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in · Fleet Ops",
};

export default function LoginPage() {
  const contactUrl = `https://wa.me/${FLEETOPS_WHATSAPP.replace(/\D/g, "")}?text=${encodeURIComponent(FLEETOPS_ENQUIRY)}`;
  return (
    <>
      <section className="flex flex-col gap-4 rounded-3xl bg-white p-6">
        <h1 className="text-2xl font-extrabold leading-tight">Sign in</h1>
        <AuthForm mode="login" />
        <p className="text-center text-sm text-muted">
          New here? Ask your company admin to send you an invite on WhatsApp.
        </p>
      </section>
      {/* For bus owners not yet on Fleet Ops: shown on this page only. */}
      <a
        href={contactUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-3 rounded-3xl bg-brand-soft px-5 py-4 text-brand-dark"
      >
        <span className="flex flex-col">
          <span className="font-extrabold">Want Fleet Ops for your buses?</span>
          <span className="text-sm">Contact Fleet Ops on WhatsApp</span>
        </span>
        <span aria-hidden="true" className="text-xl">›</span>
      </a>
    </>
  );
}
