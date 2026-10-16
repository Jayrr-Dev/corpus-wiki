import { ReadingPane } from "@/components/shell";
import { ErrorLogTable } from "./ErrorLogTable";

// ERROR LOG (/errors): every error in the app, newest first (lib/errors/errorLog.ts writes it)
export default function ErrorLogPage() {
  return (
    <ReadingPane title="Error log" width="full">
      <ErrorLogTable />
    </ReadingPane>
  );
}
