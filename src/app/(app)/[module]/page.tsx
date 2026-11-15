import { ModuleHome } from "@/components/modules/ModuleHome";
import { TourHome } from "@/components/tours/TourHome";
import { TownOverview } from "@/components/overview/TownOverview";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

/** Every module opens on its Overview. The day book is one tap away. */
export default async function ModuleHomePage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "home");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  if (access.module === "town") {
    return <TownOverview key={access.module} />;
  }
  if (access.module === "tour") {
    return <TourHome key={access.module} organizationId={access.membership.organizationId} />;
  }
  return <ModuleHome key={access.module} organizationId={access.membership.organizationId} module={access.module} />;
}
