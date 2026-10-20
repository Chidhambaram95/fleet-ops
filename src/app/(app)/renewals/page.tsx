import { RenewalsPage } from "@/components/renewals/RenewalsPage";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function RenewalsRoute() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <RenewalsPage organizationId={access.membership.organizationId} />;
}
