import { IntercityPage } from "@/components/money/IntercityPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleIntercityPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "intercity");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <IntercityPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  );
}
