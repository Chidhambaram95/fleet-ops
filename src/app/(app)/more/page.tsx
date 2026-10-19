import Link from "next/link";
import { getActiveMembership } from "@data/auth/session";
import { isSuperAdmin } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { navLinksFor } from "@/components/layout/navLinks";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function MorePage() {
  let links = navLinksFor(null);
  let superAdmin = false;
  if (hasPublicSupabaseEnv()) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      superAdmin = await isSuperAdmin(supabase, user.id);
      try {
        links = navLinksFor((await getActiveMembership(supabase)).role);
      } catch {
        links = navLinksFor(null);
      }
    }
  }
  const rows = links.filter((link) => link.href !== "/");
  if (superAdmin) {
    rows.push({ href: "/admin/companies", label: "Super-admin", hint: "All companies and payments" });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-extrabold">More</h1>
      {rows.length > 0 ? (
        <nav aria-label="More" className="flex flex-col rounded-3xl bg-white px-4 py-1">
          {rows.map((row, index) => (
            <Link
              key={row.href}
              href={row.href}
              className={`flex items-center justify-between gap-3 py-4 ${
                index > 0 ? "border-t border-line" : ""
              }`}
            >
              <span className="flex flex-col">
                <span className="text-base font-bold">{row.label}</span>
                <span className="text-[13px] text-muted">{row.hint}</span>
              </span>
              <span aria-hidden="true" className="text-xl text-muted">
                ›
              </span>
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </div>
  );
}
