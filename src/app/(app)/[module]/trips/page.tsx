import { TripsList } from "@/components/trips/TripsList";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleTripsPage({ params }: { params: Promise<{ module: string }> }) {
  const access = await moduleAccess((await params).module, "trips");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <TripsList
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  );
}
