import { notFound } from "next/navigation";
import { z } from "zod";
import { ReadingPane } from "@/components/shell";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { readEnabledModules, requireModule } from "@/lib/modules";
import type { Scope } from "@/lib/knowledge/scopeTypes";
import { readStudySets } from "@/lib/study/service";
import type { StudySetRow } from "@/lib/study/types";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { sourceVideo } from "@/lib/video/intro";
import { signedVideoUrl, videoStore } from "@/lib/video/server";
import { type IntroVideo, StudySetView } from "./StudySetView";

export const dynamic = "force-dynamic";

// STUDY SET (/study/[id]): Practice, Progress and Questions for one set, with the person's own levels.
// Questions whose claim changed are flagged stale here and rebuilt by the page as it opens.
// The video the set opens with, when it asks for one and the Video module is on
async function introVideo(set: StudySetRow, db: ReturnType<typeof supabaseRpc>): Promise<IntroVideo | null | undefined> {
  if (!set.introVideo || !(await readEnabledModules(db)).includes("video")) return undefined;
  const video = sourceVideo(await videoStore(db).list(), { kind: set.scopeKind, id: set.scopeId } as Scope);
  if (!video) return null;
  const ready = video.status === "ready";
  const [playUrl, posterUrl] = await Promise.all([ready ? signedVideoUrl(video.videoPath) : null, ready ? signedVideoUrl(video.posterPath) : null]);
  return { id: video.id, title: video.title, ready, playUrl, posterUrl };
}

export default async function StudySetPage({ params }: { params: Promise<{ id: string }> }) {
  const db = supabaseRpc(getAdminSupabase());
  await requireModule("study", db);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();
  const data = await readStudySets(db, user.id, id.data);
  const set = data.sets[0];
  if (!set) notFound();
  return (
    <ReadingPane title={set.title}>
      <StudySetView set={set} data={data} intro={await introVideo(set, db)} />
    </ReadingPane>
  );
}
