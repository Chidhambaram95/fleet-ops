import { FuelPage } from "@/components/money/FuelPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleFuelPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "fuel");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <FuelPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  );
}
