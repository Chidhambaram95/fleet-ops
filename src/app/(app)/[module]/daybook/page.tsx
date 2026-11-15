import { Suspense } from "react";
import { DailyLedger } from "@/components/operations/DailyLedger";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function DayBookPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const access = await moduleAccess(module, "daybook");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <Suspense>
      <DailyLedger key={access.module} module={access.module} />
    </Suspense>
  );
}
