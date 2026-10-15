import { Suspense } from "react";
import { Note } from "@/app/(app)/_components/bits";
import { ReadingPane } from "@/components/shell";
import { ChangesTable } from "./ChangesTable";

// CHANGES (/changes): every ChangeSet, newest first, filterable by status, proposer, type and time.
// Suspense because the filters live in the URL (useSearchParams).
export default function ChangesPage() {
  return (
    <ReadingPane title="Changes">
      <Suspense fallback={<Note>Loading…</Note>}>
        <ChangesTable />
      </Suspense>
    </ReadingPane>
  );
}
