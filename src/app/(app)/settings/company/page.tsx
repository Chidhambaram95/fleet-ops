import { getRequestCompanyProfile, getRequestMembership } from "@data/auth/requestSession";
import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { CompanySettings } from "@/components/settings/CompanySettings";

export default async function CompanySettingsPage() {
  if (!hasPublicSupabaseEnv()) {
    return <p className="rounded-xl border border-line bg-surface px-4 py-6 text-muted">Add Supabase keys first.</p>;
  }
  try {
    const membership = await getRequestMembership();
    if (membership.role !== "admin") {
      return <p className="rounded-xl border border-line bg-surface px-4 py-6 text-muted">Only admins can change company settings.</p>;
    }
    const profile = await getRequestCompanyProfile(membership.organizationId);
    return <CompanySettings profile={profile} organizationId={membership.organizationId} />;
  } catch (error) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-money-out">
        {error instanceof Error ? error.message : "Could not load company settings."}
      </p>
    );
  }
}
