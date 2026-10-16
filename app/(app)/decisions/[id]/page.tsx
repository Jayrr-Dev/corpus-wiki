import { ReadingPane } from "@/components/shell";
import { ChangeDetail } from "../../changes/[id]/ChangeDetail";
export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReadingPane title="Decision" width="prose"><ChangeDetail changeSetId={id} /></ReadingPane>;
}
