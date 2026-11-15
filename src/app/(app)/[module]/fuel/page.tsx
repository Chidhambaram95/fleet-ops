import { FuelPage } from "@/components/money/FuelPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleFuelPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "fuel", (access) => (
    <FuelPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  ));
}
