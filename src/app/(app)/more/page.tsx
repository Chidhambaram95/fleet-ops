import Link from "next/link";
import { cookies } from "next/headers";
import { getActiveMembership } from "@data/auth/session";
import { isSuperAdmin } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import {
  hasScreen,
  isModuleId,
  LAST_MODULE_COOKIE,
  MODULE_TITLES,
  moduleHref,
  type ModuleId,
} from "@domain/modules/modules";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { companyLinks, moduleLinks, type NavLink } from "@/components/layout/navLinks";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleInfo } from "../moduleAccess";

export default async function MorePage() {
  const sections: { title: string; rows: NavLink[] }[] = [];
  let superAdmin = false;
  if (hasPublicSupabaseEnv()) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      superAdmin = await isSuperAdmin(supabase, user.id);
      const membership = await getActiveMembership(supabase).catch(() => null);
      if (membership && membership.role !== "crew") {
        const info = await moduleInfo(membership);
        const last = (await cookies()).get(LAST_MODULE_COOKIE)?.value;
        const current: ModuleId | undefined =
          isModuleId(last) && info.mine.includes(last) ? last : info.mine[0];
        if (current) {
          // Home, Trips (Crew in Town) and Reports are phone tabs already.
          const tabs = [
            moduleHref(current),
            moduleHref(current, hasScreen(current, "trips") ? "trips" : "crew"),
            moduleHref(current, "reports"),
          ];
          sections.push({
            title: MODULE_TITLES[current],
            rows: moduleLinks(current).filter((link) => !tabs.includes(link.href)),
          });
        }
        const others = info.mine.filter((item) => item !== current);
        if (others.length) {
          sections.push({
            title: "Other bus types",
            rows: others.map((item) => ({ href: moduleHref(item), label: MODULE_TITLES[item], hint: "Switch to this bus type" })),
          });
        }
        const company = companyLinks(membership.role, membership.role === "admin" || !info.limited);
        if (company.length) sections.push({ title: "Company", rows: company });
      }
    }
  }
  if (superAdmin) {
    sections.push({
      title: "Fleet Ops",
      rows: [{ href: "/admin/companies", label: "Fleet Ops admin", hint: "All companies and payments" }],
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-extrabold">Menu</h1>
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-bold text-muted">{section.title}</h2>
            <nav aria-label={section.title} className="flex flex-col rounded-3xl bg-white px-4 py-1">
              {section.rows.map((row, index) => (
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
          </section>
        ))}
      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </div>
  );
}
