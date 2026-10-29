import "server-only";

import { z } from "zod";
import { chatJson, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { FIXED_ROLES } from "@/lib/ai/roles";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { currentActor } from "@/lib/auth/currentPerson";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { loadScopeClaims, loadScopeOptions, pickCoverage, type Scope } from "@/lib/knowledge/scope";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { ratesFromEnv } from "./cost";
import type { PipelineDeps, VideoFiles, VideoStore } from "./pipeline";
import { nebiusTokenSource, serviceAccountKeyFromEnv, type TokenSource } from "./nebius";
import { nebiusJobClient } from "./render";
import { draftSchema, scriptFromDraft, scriptPrompt, type ScriptWriter } from "./script";
import { LENGTH_PLAN, type VideoLength, type VideoPatch, type VideoRow, type VideoScript, type VoiceOption } from "./types";
import { DEFAULT_VOICE_ID, elevenLabsClient } from "./voice";

// =====================================================================
// VIDEO SERVER WIRING: the real outside services behind the interfaces
// in pipeline.ts (videos table, the `videos` Storage bucket, ElevenLabs,
// Nebius) and the Narrator call behind ScriptWriter.
// Server env:
//   ELEVENLABS_API_KEY        voices scenes (Settings → Intelligence shows "Connected.")
//   NEBIUS_RENDER_PROJECT_ID  where render jobs run (a region with CPU quota; falls back to
//                             NEBIUS_PROJECT_ID)
//   NEBIUS_SERVICE_ACCOUNT_ID, NEBIUS_PUBLIC_KEY_ID and NEBIUS_PRIVATE_KEY_PATH (or
//                             NEBIUS_PRIVATE_KEY) mint the IAM tokens for the API and the image pull
//   VIDEO_RENDER_IMAGE        the render image in Nebius Container Registry
//   VIDEO_CALLBACK_BASE_URL   optional: the app's public URL the job calls back; without it the
//                             status poll reads the job from Nebius (works on localhost)
//   VIDEO_CALLBACK_SECRET     signs the callback token (needed with VIDEO_CALLBACK_BASE_URL)
// =====================================================================

export const VIDEO_BUCKET = "videos";

const adminDb = (): DbRpc => supabaseRpc(getAdminSupabase());

export function videoStore(db: DbRpc = adminDb()): VideoStore & { list(): Promise<VideoRow[]>; create(video: Record<string, unknown>): Promise<VideoRow> } {
  return {
    get: (id) => db.call<VideoRow | null>("get_video", { p_id: id }),
    update: (id, from, patch: VideoPatch) => db.call<VideoRow | null>("update_video", { p_id: id, p_from: [...from], p_patch: patch }),
    list: () => db.call<VideoRow[]>("list_videos"),
    create: (video) => db.call<VideoRow>("create_video", { p_video: video }),
  };
}

export function videoFiles(): VideoFiles {
  const bucket = () => getAdminSupabase().storage.from(VIDEO_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, typeof bytes === "string" ? new Blob([bytes], { type: contentType }) : bytes, { contentType, upsert: true });
      if (error) throw new Error(`Could not save ${path.split("/").pop()}: ${error.message}`);
    },
    async signedDownloadUrl(path, expiresIn) {
      const { data, error } = await bucket().createSignedUrl(path, expiresIn);
      if (error || !data) throw new Error(`Could not share ${path.split("/").pop()} with the render job.`);
      return data.signedUrl;
    },
    async signedUploadUrl(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
      if (error || !data) throw new Error("Could not prepare the upload for the rendered video.");
      return data.signedUrl;
    },
  };
}

const required = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`Add ${name} to the server environment to make videos.`);
  return value;
};

export const voiceConnected = () => Boolean(process.env.ELEVENLABS_API_KEY);
export const videoRates = () => ratesFromEnv(process.env);

// The project render jobs run in; it can sit in another region than the registry
const renderProjectId = () => process.env.NEBIUS_RENDER_PROJECT_ID || process.env.NEBIUS_PROJECT_ID || "";

// One token source per server process, so a minted token is reused until it nears expiry
let tokens: TokenSource | null = null;
const nebiusToken: TokenSource = () => (tokens ??= nebiusTokenSource(serviceAccountKeyFromEnv(process.env)))();

// Everything runPipeline needs, for the current space
export async function pipelineDeps(spaceId?: string | null): Promise<PipelineDeps> {
  const space = spaceId ?? (await currentActor()).spaceId;
  if (!space) throw new Error("Choose a space first.");
  const client = getAdminSupabase();
  return {
    spaceId: space,
    store: videoStore(),
    files: videoFiles(),
    voice: () => elevenLabsClient(process.env.ELEVENLABS_API_KEY ?? ""),
    jobs: () => nebiusJobClient({ projectId: renderProjectId(), token: nebiusToken }),
    renderImage: process.env.VIDEO_RENDER_IMAGE ?? "",
    callbackBaseUrl: process.env.VIDEO_CALLBACK_BASE_URL ?? "",
    callbackSecret: process.env.VIDEO_CALLBACK_SECRET ?? "",
    assetFile: async (assetId) => {
      const { data } = await client.from("assets").select("storage_path,mime_type").eq("id", assetId).eq("kind", "image").is("deleted_at", null).maybeSingle();
      if (!data) return null;
      const [bucket, ...rest] = data.storage_path.split("/");
      const { data: signed } = await client.storage.from(bucket!).createSignedUrl(rest.join("/"), 4 * 3600);
      return signed ? { url: signed.signedUrl, name: `${assetId}.${data.mime_type.split("/")[1] ?? "png"}` } : null;
    },
  };
}

// Checks the settings Make video needs, before anything starts
export function assertRenderConfigured(deps: PipelineDeps): void {
  required("ELEVENLABS_API_KEY", process.env.ELEVENLABS_API_KEY);
  required("NEBIUS_RENDER_PROJECT_ID or NEBIUS_PROJECT_ID", renderProjectId());
  serviceAccountKeyFromEnv(process.env);
  required("VIDEO_RENDER_IMAGE", deps.renderImage);
  // The callback is optional (renders finish through the status poll); a URL needs its secret
  if (deps.callbackBaseUrl) required("VIDEO_CALLBACK_SECRET", deps.callbackSecret);
}

// THE NARRATOR (role "narrator", call name video_script)
export async function narratorWriter(db: DbRpc = adminDb()): Promise<ScriptWriter> {
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("Configure an AI provider in Settings first.");
  const saved = (await loadRoleInstructions(db)).find((role) => role.role === "narrator")?.instructions;
  const instructions = saved ?? FIXED_ROLES.find((role) => role.id === "narrator")!.instructions;
  return {
    async write(input) {
      const answer = await chatJson(settings, {
        name: "video_script", schema: draftSchema, jsonSchema: z.toJSONSchema(draftSchema), retryInvalidOutput: true,
        messages: [{ role: "system", content: instructions }, { role: "user", content: scriptPrompt(input) }],
      });
      return answer.value;
    },
  };
}

// The label of a scope, for the prompt and the default title
export async function scopeLabel(scope: Scope): Promise<string> {
  if (scope.kind === "glossary") return "Glossary";
  const options = await loadScopeOptions();
  return options[scope.kind].find((option) => option.id === scope.id)?.label ?? "This topic";
}

// WRITE SCRIPT: the scope's most central claims, as many as the length covers, into scenes
export async function writeScript(input: { scope: Scope; coverage: 25 | 50 | 100; length: VideoLength; writer: ScriptWriter }): Promise<{ title: string; script: VideoScript }> {
  const claims = pickCoverage(await loadScopeClaims(input.scope), input.coverage).slice(0, LENGTH_PLAN[input.length].maxClaims);
  if (!claims.length) throw new Error("This source has no claims yet.");
  const label = await scopeLabel(input.scope);
  const used = claims.map((claim) => ({ unitId: claim.unitId, revisionId: claim.revisionId, title: claim.title, content: claim.content }));
  const draft = await input.writer.write({ scopeLabel: label, claims: used, length: input.length });
  return { title: draft.title || label, script: scriptFromDraft(draft, used) };
}

// ElevenLabs voices for the New video form; the default voice alone when no key is set or the call fails
export async function listVoices(): Promise<VoiceOption[]> {
  const fallback: VoiceOption[] = [{ id: DEFAULT_VOICE_ID, name: "Rachel", previewUrl: null }];
  if (!voiceConnected()) return fallback;
  try {
    const voices = await elevenLabsClient(process.env.ELEVENLABS_API_KEY!).voices();
    return voices.length ? voices : fallback;
  } catch {
    return fallback;
  }
}

// A short-lived link to play or download a file from the videos bucket
export async function signedVideoUrl(path: string | null, download?: string): Promise<string | null> {
  if (!path) return null;
  const { data } = await getAdminSupabase().storage.from(VIDEO_BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}
