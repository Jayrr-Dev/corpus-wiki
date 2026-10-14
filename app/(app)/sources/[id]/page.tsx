import { SourceIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

type SourceDetailPageProps = { params: Promise<{ id: string }> };

// SOURCE (/sources/[id]): stub from agent A; agent E builds it
export default async function SourceDetailPage({ params }: SourceDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Source">
      <EmptyState icon={SourceIcon} title="Nothing here yet" hint={<span className="font-mono">{id}</span>} />
    </ReadingPane>
  );
}
