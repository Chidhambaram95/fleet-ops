import { FleetManager } from "@/components/operations/FleetManager";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleBusesPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "buses", (access) => (<FleetManager key={access.module} canEdit={access.membership.role === "admin"} module={access.module} />));
}
