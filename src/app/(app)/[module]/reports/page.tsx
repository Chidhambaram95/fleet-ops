import { ReportsPage } from "@/components/reports/ReportsPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleReportsPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "reports");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <ReportsPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      modules={access.companyModules}
    />
  );
}
