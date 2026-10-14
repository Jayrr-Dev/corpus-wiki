import { ChangeIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

type ChangeDetailPageProps = { params: Promise<{ id: string }> };

// CHANGE (/changes/[id]): stub from agent A; agent E builds it
export default async function ChangeDetailPage({ params }: ChangeDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Change">
      <EmptyState icon={ChangeIcon} title="Nothing here yet" hint={<span className="font-mono">{id}</span>} />
    </ReadingPane>
  );
}
