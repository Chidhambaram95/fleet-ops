import { redirect } from "next/navigation";

/** Old link: bank and company costs moved to the Company area. */
export default function OldMoneyPage() {
  redirect("/company/costs");
}
