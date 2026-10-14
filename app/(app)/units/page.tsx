import { Suspense } from "react";
import { Note } from "@/app/(app)/_components/bits";
import { ReadingPane } from "@/components/shell";
import { UnitsScreen } from "./UnitsScreen";

// UNITS (/units): every knowledge unit, filterable by kind, status, domain, entity and state.
// Suspense because the filters live in the URL (useSearchParams).
export default function UnitsPage() {
  return (
    <ReadingPane title="Units">
      <Suspense fallback={<Note>Loading…</Note>}>
        <UnitsScreen />
      </Suspense>
    </ReadingPane>
  );
}
