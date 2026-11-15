import { HealthPage } from "@/components/health/HealthPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleHealthPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "health", (access) => (
    <HealthPage key={access.module} organizationId={access.membership.organizationId} module={access.module} />
  ));
}
