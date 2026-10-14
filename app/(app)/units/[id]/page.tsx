import { ReadingPane } from "@/components/shell";
import { UnitDetail } from "./UnitDetail";

type UnitDetailPageProps = { params: Promise<{ id: string }> };

// UNIT (/units/[id]): one unit's content, history, evidence, links and edits
export default async function UnitDetailPage({ params }: UnitDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Unit" width="prose">
      <UnitDetail unitId={id} />
    </ReadingPane>
  );
}
