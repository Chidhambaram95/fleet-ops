import { CrewPage } from "@/components/money/CrewPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleCrewPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "crew", (access) => (
    <CrewPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      modules={access.companyModules}
    />
  ));
}
