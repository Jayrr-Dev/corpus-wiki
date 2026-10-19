import { ReadingPane } from "@/components/shell";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { loadPublicationEditor, loadWikiMetrics } from "@/lib/publishing/server";
import { PublishingPanel } from "./PublishingPanel";

export const dynamic = "force-dynamic";
export default async function PublishingPage() {
  const [editor, metrics] = await Promise.all([loadPublicationEditor(), loadWikiMetrics()]);
  const version = `${editor.spaceId}:${editor.publication?.publishedAt}:${editor.publication?.visibility}:${editor.pages.map(p => p.fingerprint).join("")}`;
  return <ReadingPane title="Publishing" width="prose" actions={<Button asChild variant="ghost" size="sm"><Link href="/explore">Explore</Link></Button>}>
    <PublishingPanel key={version} editor={editor} initialMetrics={metrics} />
  </ReadingPane>;
}
