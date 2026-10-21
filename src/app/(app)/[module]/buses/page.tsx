import { FleetManager } from "@/components/operations/FleetManager";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleBusesPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "buses");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <FleetManager key={access.module} canEdit={access.membership.role === "admin"} module={access.module} />;
}
