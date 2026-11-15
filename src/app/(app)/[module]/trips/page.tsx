import { TripsList } from "@/components/trips/TripsList";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleTripsPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "trips", (access) => (
    <TripsList
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  ));
}
