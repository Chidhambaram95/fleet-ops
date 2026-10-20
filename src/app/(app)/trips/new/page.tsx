import { TripEditor } from "@/components/trips/TripEditor";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function NewTripPage() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return (
    <TripEditor
      organizationId={access.membership.organizationId}
      role={access.membership.role}
    />
  );
}
