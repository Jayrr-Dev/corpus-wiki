"use server";

import { after } from "next/server";
import { z } from "zod";
import { currentActor, withSpaceActor } from "@/lib/auth/currentPerson";
import { requireUser } from "@/lib/auth/requireUser";
import { isCompleteScope, isCoverage, type Scope } from "@/lib/knowledge/scopeTypes";
import { readEnabledModules } from "@/lib/modules";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";
import { runPipeline, startVideo } from "@/lib/video/pipeline";
import { applyScriptEdit, type ScriptEdit, scriptEditSchema } from "@/lib/video/script";
import { assertRenderConfigured, narratorWriter, pipelineDeps, videoStore, writeScript } from "@/lib/video/server";
import { canEditScript } from "@/lib/video/status";
import { isVideoLength, type VideoLength, type VideoRow } from "@/lib/video/types";

// VIDEO ACTIONS: write a script, edit it, then Make video (voice → render) or Try again.
// Nothing here costs money until makeVideo.

async function guard() {
  const user = await requireUser();
  if (!(await readEnabledModules()).includes("video")) throw new Error("Video is off. Turn it on in Settings → Features.");
  return user;
}

const videoId = (id: string) => {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new Error("This video no longer exists.");
  return parsed.data;
};

async function scriptVideo(id: string): Promise<VideoRow> {
  const video = await videoStore().get(videoId(id));
  if (!video) throw new Error("This video no longer exists.");
  if (!canEditScript(video.status)) throw new Error("The script can only change before the video is made.");
  return video;
}

export type NewVideo = { scope: Scope | null; coverage: number; length: VideoLength; voiceId: string };

// WRITE SCRIPT: the Narrator writes scenes; the video starts in status script
export async function createVideo(input: NewVideo): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const user = await guard();
    if (!isCompleteScope(input.scope)) throw new Error("Choose a source.");
    if (!isCoverage(input.coverage)) throw new Error("Choose a coverage.");
    if (!isVideoLength(input.length)) throw new Error("Choose a length.");
    const voiceId = z.string().trim().min(1).max(100).parse(input.voiceId);
    const { title, script } = await writeScript({ scope: input.scope, coverage: input.coverage, length: input.length, writer: await narratorWriter() });
    const video = await videoStore().create({
      title, scopeKind: input.scope.kind, scopeId: input.scope.kind === "glossary" ? null : input.scope.id,
      coverage: input.coverage, length: input.length, voiceId, script, createdBy: user.id,
    });
    return { id: video.id };
  });
}

// SAVE SCRIPT: edited scenes in their new order; changed narration is voiced again later
export async function saveScript(id: string, edit: ScriptEdit): Promise<ActionResult> {
  return toActionResult(async () => {
    await guard();
    const video = await scriptVideo(id);
    const parsed = scriptEditSchema.safeParse(edit);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the script.");
    const saved = await videoStore().update(video.id, ["script"], { title: parsed.data.title, script: applyScriptEdit(video.script, parsed.data) });
    if (!saved) throw new Error("This video changed while you were editing. Reload and try again.");
    return {};
  });
}

// REWRITE SCRIPT: the Narrator writes the scenes again from the same source
export async function rewriteScript(id: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await guard();
    const video = await scriptVideo(id);
    const scope = (video.scopeKind === "glossary" ? { kind: "glossary" } : { kind: video.scopeKind, id: video.scopeId }) as Scope;
    const { script } = await writeScript({ scope, coverage: video.coverage, length: video.length, writer: await narratorWriter() });
    const saved = await videoStore().update(video.id, ["script"], { script });
    if (!saved) throw new Error("This video changed while the script was written. Reload and try again.");
    return {};
  });
}

// MAKE VIDEO / TRY AGAIN: moves the video to voicing, then voices and starts the render after the response
async function start(id: string, event: "make" | "retry"): Promise<ActionResult> {
  return toActionResult(async () => {
    await guard();
    const actor = await currentActor();
    const deps = await pipelineDeps(actor.spaceId);
    assertRenderConfigured(deps);
    const video = await startVideo(deps, videoId(id), event);
    after(() => withSpaceActor(actor, async () => {
      await runPipeline(deps, video.id).catch((error) => console.error("Video pipeline failed:", error));
    }));
    return {};
  });
}

export async function makeVideo(id: string): Promise<ActionResult> {
  return start(id, "make");
}

export async function retryVideo(id: string): Promise<ActionResult> {
  return start(id, "retry");
}
