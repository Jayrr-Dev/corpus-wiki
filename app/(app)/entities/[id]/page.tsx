import { EntityIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

type EntityDetailPageProps = { params: Promise<{ id: string }> };

// ENTITY (/entities/[id]): stub from agent A; agent E builds it
export default async function EntityDetailPage({ params }: EntityDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Entity">
      <EmptyState icon={EntityIcon} title="Nothing here yet" hint={<span className="font-mono">{id}</span>} />
    </ReadingPane>
  );
}
