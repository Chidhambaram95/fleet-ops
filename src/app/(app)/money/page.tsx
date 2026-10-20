import { MoneyPage } from "@/components/money/MoneyPage";
import { AccessMessage, editorAccess } from "@/app/(app)/editorAccess";

export default async function MoneyRoute() {
  const access = await editorAccess();
  if (!access.membership) {
    return <AccessMessage message={access.message} />;
  }
  return <MoneyPage organizationId={access.membership.organizationId} />;
}
