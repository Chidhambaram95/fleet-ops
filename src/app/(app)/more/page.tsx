import Link from "next/link";
import { cookies } from "next/headers";
import { getRequestMembershipOrNull, getRequestSuperAdmin, getRequestUser } from "@data/auth/requestSession";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import {
  secondTabScreen,
  isModuleId,
  LAST_MODULE_COOKIE,
  MODULE_TITLES,
  moduleHref,
  type ModuleId,
} from "@domain/modules/modules";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { companyLinks, groupedLinks, moduleLinks, type NavLink } from "@/components/layout/navLinks";
import { moduleInfo } from "../moduleAccess";

export default async function MorePage() {
  const sections: { title: string; rows: NavLink[] }[] = [];
  let superAdmin = false;
  if (hasPublicSupabaseEnv()) {
    const user = await getRequestUser();
    if (user) {
      superAdmin = await getRequestSuperAdmin(user.id);
      const membership = await getRequestMembershipOrNull();
      if (membership && membership.role !== "crew") {
        const info = await moduleInfo(membership);
        const last = (await cookies()).get(LAST_MODULE_COOKIE)?.value;
        const current: ModuleId | undefined =
          isModuleId(last) && info.mine.includes(last) ? last : info.mine[0];
        if (current) {
          // Overview, Day book (Enquiries in Tour) and Fleet health are phone tabs already.
          const tabs = [
            moduleHref(current),
            moduleHref(current, secondTabScreen(current)),
            moduleHref(current, "health"),
          ];
          const rest = moduleLinks(current).filter((link) => !tabs.includes(link.href));
          for (const entry of groupedLinks(rest)) {
            sections.push({ title: entry.title, rows: entry.links });
          }
        }
        const others = info.mine.filter((item) => item !== current);
        if (others.length) {
          sections.push({
            title: "Other bus types",
            rows: others.map((item) => ({
              href: moduleHref(item),
              label: MODULE_TITLES[item],
              hint: "Switch to this bus type",
              icon: "buses" as const,
              group: "fleet" as const,
            })),
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
      rows: [
        {
          href: "/admin/companies",
          label: "Fleet Ops admin",
          hint: "All companies and payments",
          icon: "settings",
          group: "company",
        },
      ],
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 lg:gap-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Menu</h1>
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted">{section.title}</h2>
            <nav aria-label={section.title} className="flex flex-col rounded-xl border border-line bg-surface px-4 py-1">
              {section.rows.map((row, index) => (
                <Link
                  key={row.href}
                  href={row.href}
                  className={`flex min-h-14 items-center justify-between gap-3 py-3 ${
                    index > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink">{row.label}</span>
                    <span className="text-xs text-muted">{row.hint}</span>
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
