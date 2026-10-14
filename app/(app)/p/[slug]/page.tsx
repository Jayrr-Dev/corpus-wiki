import { PageIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

type WikiPageProps = { params: Promise<{ slug: string }> };

// PAGE (/p/[slug]): stub from agent A; agent D builds it
export default async function WikiPage({ params }: WikiPageProps) {
  const { slug } = await params;
  return (
    <ReadingPane title="Page" width="prose">
      <EmptyState icon={PageIcon} title="Nothing here yet" hint={<span className="font-mono">{slug}</span>} />
    </ReadingPane>
  );
}
