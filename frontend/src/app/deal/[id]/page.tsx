import { Suspense } from "react";
import { DealView } from "./deal-view";

export default function DealPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1280px] px-5 py-28 text-center text-sm text-muted">
          Reading the record…
        </div>
      }
    >
      <DealView />
    </Suspense>
  );
}
