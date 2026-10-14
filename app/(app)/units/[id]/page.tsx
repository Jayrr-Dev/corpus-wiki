import { UnitIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

type UnitDetailPageProps = { params: Promise<{ id: string }> };

// UNIT (/units/[id]): stub from agent A; agent E builds it
export default async function UnitDetailPage({ params }: UnitDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Unit">
      <EmptyState icon={UnitIcon} title="Nothing here yet" hint={<span className="font-mono">{id}</span>} />
    </ReadingPane>
  );
}
