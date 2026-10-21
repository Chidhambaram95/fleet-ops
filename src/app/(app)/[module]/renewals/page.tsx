import { RenewalsPage } from "@/components/renewals/RenewalsPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleRenewalsPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "renewals");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <RenewalsPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  );
}
