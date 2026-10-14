import { ReadingPane } from "@/components/shell";
import { ChangeDetail } from "./ChangeDetail";

type ChangeDetailPageProps = { params: Promise<{ id: string }> };

// CHANGE (/changes/[id]): one ChangeSet, its actions and checks, and Undo
export default async function ChangeDetailPage({ params }: ChangeDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Change" width="prose">
      <ChangeDetail changeSetId={id} />
    </ReadingPane>
  );
}
