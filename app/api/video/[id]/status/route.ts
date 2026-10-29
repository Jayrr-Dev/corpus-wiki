import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { moduleOffResponse } from "@/lib/modules";
import { estimateCost } from "@/lib/video/cost";
import { checkOverdue } from "@/lib/video/pipeline";
import { pipelineDeps, videoRates } from "@/lib/video/server";
import { progressOf } from "@/lib/video/status";

export const dynamic = "force-dynamic";

// STATUS POLL while a video is voicing or rendering. Also runs the timeout check: a render with no
// callback past the job timeout is read from Nebius and marked failed with its log tail.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try { await requireUser(); } catch { return Response.json({ error: "Not signed in." }, { status: 401 }); }
  const off = await moduleOffResponse("video");
  if (off) return off;
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return Response.json({ error: "Not found." }, { status: 404 });
  const deps = await pipelineDeps();
  const found = await deps.store.get(parsed.data);
  if (!found) return Response.json({ error: "Not found." }, { status: 404 });
  const video = await checkOverdue(deps, found);
  const progress = progressOf(video, Date.now(), estimateCost(video.script, video.length, videoRates()).renderMs);
  return Response.json({ status: video.status, error: video.error, progress }, { headers: { "Cache-Control": "no-store" } });
}
