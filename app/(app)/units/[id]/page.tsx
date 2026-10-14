import { LocalGraph } from "@/components/graph";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import { UnitDetail } from "./UnitDetail";

type UnitDetailPageProps = { params: Promise<{ id: string }> };

// UNIT (/units/[id]): one unit's content, history, evidence, links and edits; its local graph on the right
export default async function UnitDetailPage({ params }: UnitDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Unit" width="prose">
      <UnitDetail unitId={id} />
      <RightPanelSlot>
        <LocalGraph centerId={id} />
      </RightPanelSlot>
    </ReadingPane>
  );
}
