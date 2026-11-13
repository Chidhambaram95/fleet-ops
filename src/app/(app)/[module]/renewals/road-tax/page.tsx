import { PayRoadTaxPage } from "@/components/renewals/PayRoadTaxPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleRoadTaxPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "renewals");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <PayRoadTaxPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      isAdmin={access.membership.role === "admin"}
    />
  );
}
