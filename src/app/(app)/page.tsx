import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getActiveMembership } from "@data/auth/session";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { moduleHref } from "@domain/modules/modules";
import { DailyLedger } from "@/components/operations/DailyLedger";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { homeModule } from "@/app/(app)/moduleAccess";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Crew get their bus's day book. Admins and managers go to their last module. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  if (hasPublicSupabaseEnv()) {
    const membership = await getActiveMembership(await createServerSupabaseClient()).catch(() => null);
    if (membership && membership.role !== "crew") {
      const openModule = await homeModule(membership);
      if (!openModule) {
        return (
          <AccessMessage
            message={
              membership.role === "admin"
                ? "No bus types are switched on. Turn one on in Company settings."
                : "You don't have a module to open yet. Ask your admin."
            }
          />
        );
      }
      const { add } = await searchParams;
      const home = openModule === "town" ? moduleHref(openModule) : moduleHref(openModule, "daybook");
      redirect(add ? `${home}?add=${encodeURIComponent(add)}` : moduleHref(openModule));
    }
  }
  return (
    <Suspense>
      <DailyLedger />
    </Suspense>
  );
}
