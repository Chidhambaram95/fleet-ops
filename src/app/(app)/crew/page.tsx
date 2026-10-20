import { CrewPage } from "@/components/money/CrewPage";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function CrewRoute() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <CrewPage organizationId={access.membership.organizationId} />;
}
