import { Suspense } from "react";
import { EnquiriesPage } from "@/components/tours/EnquiriesPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleEnquiriesPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "enquiries");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <Suspense>
      <EnquiriesPage organizationId={access.membership.organizationId} />
    </Suspense>
  );
}
