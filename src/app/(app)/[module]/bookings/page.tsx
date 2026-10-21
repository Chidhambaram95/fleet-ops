import { BookingsPage } from "@/components/tours/BookingsPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleBookingsPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "bookings");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <BookingsPage organizationId={access.membership.organizationId} />;
}
