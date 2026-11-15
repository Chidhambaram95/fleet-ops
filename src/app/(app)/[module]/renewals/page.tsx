import { RenewalsPage } from "@/components/renewals/RenewalsPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleRenewalsPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "renewals", (access) => (
    <RenewalsPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      isAdmin={access.membership.role === "admin"}
    />
  ));
}
