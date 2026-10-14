import { DomainIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// DOMAINS (/domains): stub from agent A; agent E builds it
export default function DomainsPage() {
  return (
    <ReadingPane title="Domains">
      <EmptyState icon={DomainIcon} title="No domains yet" />
    </ReadingPane>
  );
}
