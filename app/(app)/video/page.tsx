import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { loadScopeOptions } from "@/lib/knowledge/scope";
import { SCOPE_KIND_LABELS } from "@/lib/knowledge/scopeTypes";
import { requireModule } from "@/lib/modules";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { signedVideoUrl, videoStore } from "@/lib/video/server";
import { videoTree, type VideoTreeNode } from "@/lib/video/tree";
import { formatDuration, type VideoRow } from "@/lib/video/types";
import { NewVideoButton } from "./NewVideoForm";
import { StatusChip } from "./StatusChip";

export const dynamic = "force-dynamic";

type Posters = ReadonlyMap<string, string | null>;

// One video as a card: poster, title, length and state
function VideoCard({ video, poster, source }: { video: VideoRow; poster: string | null | undefined; source?: boolean }) {
  return (
    <Link href={`/video/${video.id}`} className="group flex flex-col overflow-hidden rounded-xl border bg-background outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex aspect-video items-center justify-center bg-muted">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage link
          <img src={poster} alt="" className="size-full object-cover" />
        ) : (
          <Clapperboard className="text-faint" />
        )}
      </div>
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium">{video.title}</p>
          <p className="text-panel text-muted-foreground">{formatDuration(video.durationMs) || `${video.script.scenes.length} scenes`}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusChip status={video.status} />
          {source ? <Badge variant="outline">{SCOPE_KIND_LABELS[video.scopeKind]}</Badge> : null}
        </div>
      </div>
    </Link>
  );
}

function VideoGrid({ videos, posters, source }: { videos: VideoRow[]; posters: Posters; source?: boolean }) {
  if (!videos.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => <li key={video.id}><VideoCard video={video} poster={posters.get(video.id)} source={source} /></li>)}
    </ul>
  );
}

// Every topic under an area that holds videos, with its parent path ("Confined Space Entry / Atmosphere Testing")
function topicsWithVideos(nodes: VideoTreeNode[], path: string[] = []): { node: VideoTreeNode; path: string[] }[] {
  return nodes.flatMap((node) => [...(node.videos.length ? [{ node, path }] : []), ...topicsWithVideos(node.children, [...path, node.name])]);
}

// AREA: a second-level topic as a panel; each topic under it is a heading over its videos
function Area({ node, posters }: { node: VideoTreeNode; posters: Posters }) {
  return (
    <section className="grid gap-4 rounded-2xl border bg-muted/30 p-3 sm:p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="truncate font-semibold">{node.name}</h3>
        <span className="shrink-0 text-panel text-muted-foreground">{node.count} {node.count === 1 ? "video" : "videos"}</span>
      </header>
      <VideoGrid videos={node.videos} posters={posters} />
      {topicsWithVideos(node.children).map(({ node: topic, path }) => (
        <div key={topic.id} className="grid gap-2">
          <h4 className="min-w-0 truncate text-panel font-medium">
            {path.length ? <span className="text-muted-foreground">{path.join(" / ")} / </span> : null}
            {topic.name}
          </h4>
          <VideoGrid videos={topic.videos} posters={posters} />
        </div>
      ))}
    </section>
  );
}

// ROOT: a top-level topic as a titled section of areas
function Root({ node, posters }: { node: VideoTreeNode; posters: Posters }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold tracking-tight">{node.name}</h2>
      <VideoGrid videos={node.videos} posters={posters} />
      {node.children.map((child) => <Area key={child.id} node={child} posters={posters} />)}
    </section>
  );
}

// VIDEO (/video): narrated videos made from a topic or article (docs/knowledge-modules-plan.md),
// laid out on the domain tree like Docs. 404 while the module is off in Settings → Features.
export default async function VideoPage() {
  await requireModule("video");
  const [videos, options, domains] = await Promise.all([
    videoStore().list(),
    loadScopeOptions(),
    getAdminSupabase().from("domains").select("*").is("retired_at", null),
  ]);
  const posters = new Map(await Promise.all(videos.map(async (video) => [video.id, video.status === "ready" ? await signedVideoUrl(video.posterPath) : null] as const)));
  const { roots, other } = videoTree(domains.data ?? [], videos);
  return (
    <ReadingPane title="Video" actions={<NewVideoButton options={options} />}>
      {videos.length ? (
        <div className="grid gap-8">
          {roots.map((root) => <Root key={root.id} node={root} posters={posters} />)}
          {other.length ? (
            <section className="grid gap-3">
              <h2 className="text-xl font-semibold tracking-tight">Other sources</h2>
              <VideoGrid videos={other} posters={posters} source />
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState icon={Clapperboard} title="No videos yet." />
      )}
    </ReadingPane>
  );
}
