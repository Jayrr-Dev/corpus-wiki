import { ReadingPane } from "@/components/shell";
import { SourceDetail } from "./SourceDetail";

type SourceDetailPageProps = { params: Promise<{ id: string }> };

// SOURCE (/sources/[id]): the file's passages in order and the units each produced
export default async function SourceDetailPage({ params }: SourceDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Source" width="prose">
      <SourceDetail sourceId={id} />
    </ReadingPane>
  );
}
