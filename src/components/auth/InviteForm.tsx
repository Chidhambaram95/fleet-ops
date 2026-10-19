"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmail } from "@data/auth/email";
import { acceptInvite } from "@data/companies/repository";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const field =
  "h-12 rounded-2xl bg-canvas px-4 text-base font-normal";

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
  const [info, setInfo] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const client = createBrowserSupabaseClient();
    try {
      if (hasLogin) {
        await signInWithEmail(client, email.trim(), password);
      } else {
        const { data, error: signUpError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (signUpError) throw new Error(signUpError.message);
        if (data.user?.identities && data.user.identities.length === 0) {
          throw new Error("An account with that email already exists. Choose “I already have a login”.");
        }
        if (!data.session) {
          setInfo(
            "Check your email to confirm the account. Then sign in here with “I already have a login”.",
          );
          return;
        }
      }
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
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} required className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Email
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
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
      {info ? <p className="text-sm text-muted">{info}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-2xl bg-brand px-4 text-base font-bold text-white disabled:opacity-60"
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
