import { ExceptionIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// EXCEPTIONS (/exceptions): stub from agent A; agent E builds it
export default function ExceptionsPage() {
  return (
    <ReadingPane title="Exceptions">
      <EmptyState icon={ExceptionIcon} title="Nothing needs you" />
    </ReadingPane>
  );
}
