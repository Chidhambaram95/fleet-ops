"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmail,
  signUpWithEmail,
} from "@data/auth/email";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");

    const client = createBrowserSupabaseClient();
    try {
      if (mode === "login") {
        await signInWithEmail(client, email.trim(), password);
        router.replace("/");
        router.refresh();
        return;
      }

      const result = await signUpWithEmail(client, email.trim(), password);
      if (result.session) {
        router.replace("/");
        router.refresh();
        return;
      }

      setInfo("Check your email to confirm the account, then sign in.");
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
        Email
        <input
          type="email"
          autoComplete="email"
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
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          required
          className="h-12 rounded-2xl bg-canvas px-4 text-base font-normal"
        />
      </label>
      {error ? <p className="text-sm text-money-out">{error}</p> : null}
      {info ? <p className="text-sm text-muted">{info}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-2xl bg-brand px-4 text-base font-bold text-white disabled:opacity-60"
      >
        {busy
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </button>
    </form>
  );
}
