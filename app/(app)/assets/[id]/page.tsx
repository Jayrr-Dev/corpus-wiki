import { ReadingPane } from "@/components/shell";
import { AssetDetail } from "./AssetDetail";

type AssetDetailPageProps = { params: Promise<{ id: string }> };

// ONE ASSET (/assets/[id]): the media itself, what the AI wrote about it, its source and the claims it backs
export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { id } = await params;
  return (
    <ReadingPane title="Asset" width="prose">
      <AssetDetail assetId={id} />
    </ReadingPane>
  );
}
