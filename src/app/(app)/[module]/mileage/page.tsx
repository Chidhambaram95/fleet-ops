import { MileagePage } from "@/components/mileage/MileagePage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleMileagePage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "mileage", (access) => (
    <MileagePage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      isAdmin={access.membership.role === "admin"}
    />
  ));
}
