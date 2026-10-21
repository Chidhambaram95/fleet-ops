import { ReportsPage } from "@/components/reports/ReportsPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { companyAccess } from "@/app/(app)/moduleAccess";

export default async function CombinedReportRoute() {
  const access = await companyAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <ReportsPage organizationId={access.membership.organizationId} module={null} modules={access.companyModules} />
  );
}
