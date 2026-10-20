import { FuelPage } from "@/components/money/FuelPage";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function FuelRoute() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <FuelPage organizationId={access.membership.organizationId} />;
}
