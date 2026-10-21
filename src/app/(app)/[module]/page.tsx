import { Suspense } from "react";
import { ModuleHome } from "@/components/modules/ModuleHome";
import { DailyLedger } from "@/components/operations/DailyLedger";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

/** Town opens on its day book; Omni and Tour on their own home. */
export default async function ModuleHomePage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "home");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  if (access.module === "town") {
    return (
      <Suspense>
        <DailyLedger key={access.module} module={access.module} />
      </Suspense>
    );
  }
  return <ModuleHome key={access.module} organizationId={access.membership.organizationId} module={access.module} />;
}
