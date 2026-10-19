import { Suspense } from "react";
import { DailyLedger } from "@/components/operations/DailyLedger";

export default function HomePage() {
  return (
    <Suspense>
      <DailyLedger />
    </Suspense>
  );
}
