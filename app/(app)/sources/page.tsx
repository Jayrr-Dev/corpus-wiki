import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ReadingPane } from "@/components/shell";
import { SourcesTable } from "./SourcesTable";

// SOURCES (/sources): every uploaded file, newest source date first
export default function SourcesPage() {
  return (
    <ReadingPane title="Sources" actions={<NewSourceLink />}>
      <SourcesTable />
    </ReadingPane>
  );
}

// NEW SOURCE: a source is created by uploading its file
function NewSourceLink() {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href="/upload">Upload files</Link>
    </Button>
  );
}
