import { CrewPage } from "@/components/money/CrewPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleCrewPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "crew");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <CrewPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      modules={access.companyModules}
    />
  );
}
