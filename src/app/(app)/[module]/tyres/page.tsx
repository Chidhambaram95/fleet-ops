import { TyresPage } from "@/components/tyres/TyresPage";
import { withModule } from "@/app/(app)/moduleAccess";

export default function ModuleTyresPage({ params }: { params: Promise<{ module: string }> }) {
  return withModule(params, "tyres", (access) => (
    <TyresPage
      key={access.module}
      organizationId={access.membership.organizationId}
      module={access.module}
      role={access.membership.role}
    />
  ));
}
