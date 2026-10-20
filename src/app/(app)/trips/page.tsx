import { TripsList } from "@/components/trips/TripsList";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function TripsPage() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <TripsList organizationId={access.membership.organizationId} />;
}
