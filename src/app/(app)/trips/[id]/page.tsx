import { redirectToModuleScreen } from "@/app/(app)/moduleAccess";

/** Old link: opens trips in the person's module. */
export default async function OldTripPage({ params }: { params: Promise<{ id: string }> }) {
  return redirectToModuleScreen("trips", `/${encodeURIComponent((await params).id)}`);
}
