import Link from "next/link";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/admin/SignOutButton";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!hasPublicSupabaseEnv()) {
    redirect("/login");
  }
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  if (!(await isSuperAdmin(supabase, user.id))) {
    redirect("/");
  }

  const link =
    "flex min-h-10 items-center rounded-full px-3.5 text-sm font-medium text-[#E6E7FA] hover:bg-white/10";
  return (
    <div className="min-h-dvh bg-[#F3F4FB] text-[#1A1B2E]">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-[#1A1B2E] px-4 py-3 text-white sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3A3FB8] font-extrabold">
            F
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-extrabold">Fleet Ops</span>
            <span className="text-xs text-[#C9CBF2]">Super-admin</span>
          </span>
        </div>
        <nav aria-label="Super-admin" className="flex flex-wrap gap-1">
          <Link href="/admin/companies" className={link}>
            Companies
          </Link>
          <Link href="/admin/payments" className={link}>
            Payments
          </Link>
        </nav>
        <SignOutButton />
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
