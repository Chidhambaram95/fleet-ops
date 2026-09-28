"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@data/auth/email";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function AppHeader({ email }: { email: string }) {
  const router = useRouter();

  async function onSignOut() {
    await signOut(createBrowserSupabaseClient());
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-orange-800">
            Fleet Ops
          </p>
          <p className="truncate text-sm text-stone-600">{email || "Signed in"}</p>
        </div>
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="shrink-0 rounded-xl bg-stone-100 px-3 text-sm font-medium text-stone-800"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
