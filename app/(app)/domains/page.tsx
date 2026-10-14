import { ReadingPane } from "@/components/shell";
import { DomainsTree } from "./DomainsTree";

// DOMAINS (/domains): the domain tree with how many current units sit in each branch
export default function DomainsPage() {
  return (
    <ReadingPane title="Domains" width="prose">
      <DomainsTree />
    </ReadingPane>
  );
}
