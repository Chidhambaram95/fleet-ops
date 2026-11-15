import { PayRoadTaxPage } from "@/components/renewals/PayRoadTaxPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleRoadTaxPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "renewals", (access) => (
    <PayRoadTaxPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      isAdmin={access.membership.role === "admin"}
    />
  ));
}
