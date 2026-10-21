import { CompanyCostsPage } from "@/components/money/CompanyCostsPage";
import { AccessMessage } from "@/app/(app)/editorAccess";
import { companyAccess } from "@/app/(app)/moduleAccess";

export default async function CompanyCostsRoute() {
  const access = await companyAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <CompanyCostsPage organizationId={access.membership.organizationId} modules={access.companyModules} />;
}
