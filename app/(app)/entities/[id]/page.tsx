import { ReadingPane } from "@/components/shell";
import { EntityDetail } from "./EntityDetail";

type EntityDetailPageProps = { params: Promise<{ id: string }> };

// ENTITY (/entities/[id]): every unit about it and its wiki page
export default async function EntityDetailPage({ params }: EntityDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Entity" width="prose">
      <EntityDetail entityId={id} />
    </ReadingPane>
  );
}
