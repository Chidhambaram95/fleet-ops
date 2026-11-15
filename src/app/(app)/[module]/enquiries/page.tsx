import { Suspense } from "react";
import { EnquiriesPage } from "@/components/tours/EnquiriesPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleEnquiriesPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "enquiries", (access) => (
    <Suspense>
      <EnquiriesPage organizationId={access.membership.organizationId} />
    </Suspense>
  ));
}
