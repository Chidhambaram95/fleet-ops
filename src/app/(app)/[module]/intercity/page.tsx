import { IntercityPage } from "@/components/money/IntercityPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleIntercityPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "intercity", (access) => (
    <IntercityPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
    />
  ));
}
