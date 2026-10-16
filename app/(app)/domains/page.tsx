import { ReadingPane } from "@/components/shell";
import { DomainsTree } from "./DomainsTree";
import { DomainsPageMenu } from "./DomainsPageMenu";

type DomainsPageProps = { searchParams: Promise<{ retired?: string }> };

// DOMAINS (/domains): the domain tree with how many current units sit in each branch;
// ?retired=1 also lists retired domains
export default async function DomainsPage({ searchParams }: DomainsPageProps) {
  const showRetired = (await searchParams).retired === "1";
  return (
    <ReadingPane
      title="Domains"
      width="prose"
      actions={
        <div className="flex items-center gap-1">
          <DomainsPageMenu showRetired={showRetired} />
        </div>
      }
    >
      <DomainsTree showRetired={showRetired} />
    </ReadingPane>
  );
}


