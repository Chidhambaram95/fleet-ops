import { TripEditor } from "@/components/trips/TripEditor";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access] = await Promise.all([params, editorAccess()]);
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <TripEditor
      key={id}
      organizationId={access.membership.organizationId}
      role={access.membership.role}
      tripId={id}
    />
  );
}
