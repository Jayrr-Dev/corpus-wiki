import { UploadIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// UPLOAD (/upload): stub from agent A; agent E builds it
export default function UploadPage() {
  return (
    <ReadingPane title="Upload">
      <EmptyState icon={UploadIcon} title="Drop files here to add knowledge" />
    </ReadingPane>
  );
}
