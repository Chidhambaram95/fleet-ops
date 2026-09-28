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
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          required
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 text-base font-normal"
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {info ? <p className="text-sm text-stone-700">{info}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-orange-700 px-4 text-base font-semibold text-white disabled:opacity-60"
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
