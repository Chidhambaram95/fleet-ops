"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { sendPasswordReset, setNewPassword } from "@data/auth/email";
import { MIN_PASSWORD_LENGTH, parseLoginId, passwordProblem } from "@domain/auth/loginId";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const INPUT = "h-12 rounded-2xl bg-canvas px-4 text-base font-normal";
const BUTTON = "h-12 rounded-2xl bg-brand px-4 text-base font-bold text-white disabled:opacity-60";

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Email logins get a reset link. Phone logins ask their admin. */
export function ForgotPasswordForm() {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"" | "sent" | "phone">("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult("");
    const parsed = parseLoginId(login);
    if (!parsed) {
      setError("Enter your email or your 10-digit phone number.");
      return;
    }
    if (parsed.kind === "phone") {
      setResult("phone");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(
        createBrowserSupabaseClient(),
        parsed.email,
        `${window.location.origin}/reset-password`,
      );
      setResult("sent");
    } catch (resetError) {
      setError(messageFromUnknown(resetError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Email or phone number
        <input
          type="text"
          inputMode="email"
          autoComplete="username"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          required
          className={INPUT}
        />
      </label>
      {error ? <p className="text-sm text-money-out">{error}</p> : null}
      {result === "sent" ? (
        <p role="status" className="rounded-2xl bg-brand-soft p-3 text-sm text-brand-dark">
          If this email has a Fleet Ops login, a reset link is on its way. Open it on this same phone or
          laptop.
        </p>
      ) : null}
      {result === "phone" ? (
        <p role="status" className="rounded-2xl bg-brand-soft p-3 text-sm text-brand-dark">
          Phone number logins are reset by your company admin. Ask them to open Team &amp; logins and
          set a new password for you.
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={BUTTON}>
        {busy ? "Please wait…" : "Send reset link"}
      </button>
      <Link href="/login" className="text-center text-sm font-semibold text-brand">
        Back to sign in
      </Link>
    </form>
  );
}

/** Opened from the reset email. The link signs the person in for this one step. */
export function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // The browser client reads the code in the link while it starts up.
    void createBrowserSupabaseClient()
      .auth.getSession()
      .then(({ data }) => setReady(data.session ? "yes" : "no"))
      .catch(() => setReady("no"));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await setNewPassword(createBrowserSupabaseClient(), password);
      router.replace("/");
      router.refresh();
    } catch (updateError) {
      setError(messageFromUnknown(updateError));
      setBusy(false);
    }
  }

  if (ready === "checking") {
    return <p className="text-muted">Checking the link…</p>;
  }
  if (ready === "no") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          This link has expired or was opened on a different phone or laptop. Ask for a new link and open
          it on the same device.
        </p>
        <Link href="/forgot-password" className={`${BUTTON} flex items-center justify-center`}>
          Ask for a new link
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
          className={INPUT}
        />
      </label>
      {error ? <p className="text-sm text-money-out">{error}</p> : null}
      <button type="submit" disabled={busy} className={BUTTON}>
        {busy ? "Please wait…" : "Save new password"}
      </button>
    </form>
  );
}
