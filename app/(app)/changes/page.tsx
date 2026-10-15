import { Suspense } from "react";
import { ReadingPane } from "@/components/shell";
import { ChangesTable } from "./ChangesTable";
import { Loader } from "@/components/standard/loader";

// CHANGES (/changes): every ChangeSet, newest first, filterable by status, proposer, type and time.
// Suspense because the filters live in the URL (useSearchParams).
export default function ChangesPage() {
  return (
    <ReadingPane title="Changes" width="full">
      <Suspense fallback={<Loader />}>
        <ChangesTable />
      </Suspense>
    </ReadingPane>
  );
}
