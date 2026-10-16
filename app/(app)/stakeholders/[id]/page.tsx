import { LocalGraph } from "@/components/graph";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import { StakeholderDetail } from "./StakeholderDetail";

type StakeholderPageProps = { params: Promise<{ id: string }> };

// ONE STAKEHOLDER (/stakeholders/[id]): the full card, its claims and sources; its local graph on the right
export default async function StakeholderPage({ params }: StakeholderPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Stakeholder" width="prose">
      <StakeholderDetail entityId={id} />
      <RightPanelSlot>
        <LocalGraph centerId={id} />
      </RightPanelSlot>
    </ReadingPane>
  );
}
