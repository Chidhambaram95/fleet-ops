import { getActiveMembership } from "@data/auth/session";
import { getCompanyProfile } from "@data/companies/repository";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function CompanySettingsPage() {
  if (!hasPublicSupabaseEnv()) {
    return <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">Add Supabase keys first.</p>;
  }
  try {
    const supabase = await createServerSupabaseClient();
    const membership = await getActiveMembership(supabase);
    if (membership.role !== "admin") {
      return <p className="rounded-2xl bg-white px-4 py-6 text-stone-700 shadow-sm">Only admins can change company settings.</p>;
    }
    const profile = await getCompanyProfile(supabase, membership.organizationId);
    return <CompanySettings profile={profile} />;
  } catch (error) {
    return (
      <p className="rounded-2xl bg-white px-4 py-6 text-red-700 shadow-sm">
        {error instanceof Error ? error.message : "Could not load company settings."}
      </p>
    );
  }
}
