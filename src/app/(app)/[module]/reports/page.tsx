import { ReportsPage } from "@/components/reports/ReportsPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleReportsPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "reports", (access) => (
    <ReportsPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      modules={access.companyModules}
    />
  ));
}
