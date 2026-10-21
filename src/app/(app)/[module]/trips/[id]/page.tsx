import { TripEditor } from "@/components/trips/TripEditor";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleTripPage({ params }: { params: Promise<{ module: string; id: string }> }) {
  const { module, id } = await params;
  const access = await moduleAccess(module, "trips");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <TripEditor
      key={`${access.module}:${id}`}
      organizationId={access.membership.organizationId}
      module={access.module}
      role={access.membership.role}
      tripId={id}
    />
  );
}
