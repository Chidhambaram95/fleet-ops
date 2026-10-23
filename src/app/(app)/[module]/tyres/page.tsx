import { TyresPage } from "@/components/tyres/TyresPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleTyresPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "tyres");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <TyresPage key={access.module} organizationId={access.membership.organizationId} module={access.module} />;
}
