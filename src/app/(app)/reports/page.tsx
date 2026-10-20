import { ReportsPage } from "@/components/reports/ReportsPage";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function ReportsRoute() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <ReportsPage organizationId={access.membership.organizationId} />;
}
