import { ReadingPane } from "@/components/shell";
import { SourcesTable } from "./SourcesTable";

// SOURCES (/sources): every uploaded file, newest source date first
export default function SourcesPage() {
  return (
    <ReadingPane title="Sources">
      <SourcesTable />
    </ReadingPane>
  );
}
