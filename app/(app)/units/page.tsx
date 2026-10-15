import { Suspense } from "react";
import { ReadingPane } from "@/components/shell";
import { NewUnitButton } from "./NewUnitButton";
import { UnitsScreen } from "./UnitsScreen";
import { Loader } from "@/components/standard/loader";

// UNITS (/units): every knowledge unit, filterable by kind, status, domain, entity and state.
// Suspense because the filters live in the URL (useSearchParams).
export default function UnitsPage() {
  return (
    <ReadingPane title="Units" actions={<NewUnitButton />}>
      <Suspense fallback={<Loader />}>
        <UnitsScreen />
      </Suspense>
    </ReadingPane>
  );
}
