import { TripEditor } from "@/components/trips/TripEditor";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { moduleAccess } from "@/app/(app)/moduleAccess";

export default async function ModuleNewTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;
  const access = await moduleAccess((await params).module, "trips");
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <TripEditor
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      role={access.membership.role}
      bookingId={access.module === "tour" ? booking : undefined}
    />
  );
}
