import { LocalGraph } from "@/components/graph";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import { EntityDetail } from "./EntityDetail";

type EntityDetailPageProps = { params: Promise<{ id: string }> };

// ENTITY (/entities/[id]): every unit about it and its wiki page; its local graph on the right
export default async function EntityDetailPage({ params }: EntityDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Entity" width="prose">
      <EntityDetail entityId={id} />
      <RightPanelSlot>
        <LocalGraph centerId={id} />
      </RightPanelSlot>
    </ReadingPane>
  );
}
