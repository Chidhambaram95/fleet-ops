"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@data/auth/email";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut(createBrowserSupabaseClient());
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-full bg-brand-pale px-4 text-sm font-bold text-brand-dark"
    >
      Sign out
    </button>
  );
}
