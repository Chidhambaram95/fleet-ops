import { TyreDetail } from "@/components/tyres/TyreDetail";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleTyrePage({ params }: { params: Promise<{ module: string; id: string }> }) {
  const { module, id } = await params;
  const access = await moduleAccess(module, "tyres");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <TyreDetail
      key={`${access.module}:${id}`}
      organizationId={access.membership.organizationId}
      module={access.module}
      role={access.membership.role}
      tyreId={id}
    />
  );
}
