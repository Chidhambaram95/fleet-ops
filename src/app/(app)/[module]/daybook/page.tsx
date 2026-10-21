import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DailyLedger } from "@/components/operations/DailyLedger";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function DayBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ add?: string }>;
}) {
  const { module } = await params;
  // Town's home is its day book.
  if (module === "town") {
    const { add } = await searchParams;
    redirect(add ? `/town?add=${encodeURIComponent(add)}` : "/town");
  }
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
