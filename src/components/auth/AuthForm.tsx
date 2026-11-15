"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseLoginId } from "@domain/auth/loginId";
import { signInWithEmail } from "@data/auth/email";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** The sign-in form. Accounts are made from an invite or by a company admin, never here. */
export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const client = createBrowserSupabaseClient();
    try {
      const login = parseLoginId(email);
      if (!login) {
        setError("Enter your email or your 10-digit phone number.");
        return;
      }
      await signInWithEmail(client, login.email, password);
      router.replace("/");
      router.refresh();
    } catch (authError) {
      setError(messageFromUnknown(authError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Email or phone number
        <input
          type="text"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          required
          className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
        />
      </label>
      <Link href="/forgot-password" className="self-end text-sm font-semibold text-brand">
        Forgot password?
      </Link>
      {error ? <p className="text-sm text-money-out">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-2xl bg-brand px-4 text-base font-bold text-white disabled:opacity-60"
      >
        {busy ? "Please wait…" : "Sign in"}
      </button>
    </form>
  );
}
