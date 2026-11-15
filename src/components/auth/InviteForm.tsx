"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmail } from "@data/auth/email";
import { acceptInvite } from "@data/companies/repository";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { createInviteLoginAction } from "@/app/(auth)/invite/[token]/actions";

const field =
  "h-12 rounded-lg border border-line-strong bg-surface px-4 text-base font-normal";

export function InviteForm({
  token,
  initialName,
}: {
  token: string;
  initialName: string;
}) {
  const router = useRouter();
  const [hasLogin, setHasLogin] = useState(false);
  const [name, setName] = useState(initialName);
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
      if (!hasLogin) {
        // The login is made on the server: public sign-up is switched off.
        const created = await createInviteLoginAction({ token, name, email, password });
        if (created.error) throw new Error(created.error);
      }
      await signInWithEmail(client, email.trim().toLowerCase(), password);
      await acceptInvite(client, token);
      router.replace("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
      {hasLogin ? null : (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} required className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {hasLogin ? "Password" : "Create a password"}
        <input
          type="password"
          autoComplete={hasLogin ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
          className={field}
        />
      </label>
      {error ? <p className="text-sm text-money-out">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-lg bg-brand px-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Please wait…" : "Join"}
      </button>
      <button
        type="button"
        onClick={() => setHasLogin((value) => !value)}
        className="text-sm font-medium text-brand"
      >
        {hasLogin ? "I am new, create a password" : "I already have a login"}
      </button>
    </form>
  );
}
