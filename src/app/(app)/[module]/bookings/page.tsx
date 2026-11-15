import { BookingsPage } from "@/components/tours/BookingsPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleBookingsPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "bookings", (access) => (<BookingsPage organizationId={access.membership.organizationId} />));
}
