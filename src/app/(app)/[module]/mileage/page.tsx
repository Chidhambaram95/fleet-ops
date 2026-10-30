import { MileagePage } from "@/components/mileage/MileagePage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleMileagePage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "mileage");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <MileagePage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      isAdmin={access.membership.role === "admin"}
    />
  );
}
