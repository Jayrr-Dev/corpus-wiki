import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { loadScopeOptions } from "@/lib/knowledge/scope";
import { requireModule } from "@/lib/modules";
import { signedVideoUrl, videoStore } from "@/lib/video/server";
import { formatDuration } from "@/lib/video/types";
import { NewVideoButton } from "./NewVideoForm";
import { StatusChip } from "./StatusChip";

export const dynamic = "force-dynamic";

// VIDEO (/video): narrated videos made from a topic or article (docs/knowledge-modules-plan.md).
// 404 while the module is off in Settings → Features.
export default async function VideoPage() {
  await requireModule("video");
  const [videos, options] = await Promise.all([videoStore().list(), loadScopeOptions()]);
  const posters = await Promise.all(videos.map((video) => (video.status === "ready" ? signedVideoUrl(video.posterPath) : null)));
  return (
    <ReadingPane title="Video" actions={<NewVideoButton options={options} />}>
      {videos.length ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video, index) => (
            <li key={video.id}>
              <Link href={`/video/${video.id}`} className="group flex flex-col overflow-hidden rounded-xl border outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex aspect-video items-center justify-center bg-muted">
                  {posters[index] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage link
                    <img src={posters[index]!} alt="" className="size-full object-cover" />
                  ) : (
                    <Clapperboard className="text-faint" />
                  )}
                </div>
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{video.title}</p>
                    <p className="text-panel text-muted-foreground">{formatDuration(video.durationMs) || `${video.script.scenes.length} scenes`}</p>
                  </div>
                  <StatusChip status={video.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Clapperboard} title="No videos yet." />
      )}
    </ReadingPane>
  );
}
