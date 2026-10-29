import { z } from "zod";
import { finishRender, type VideoStore } from "./pipeline";
import { bearer, type CallbackClaims, verifyCallbackToken } from "./token";

// =====================================================================
// RENDER CALLBACK (POST /api/video/[id]/rendered): the render job reports
// that the MP4 and poster are uploaded, or that it failed. No session:
// the signed token is the only way in, and it names the space to write to.
// Kept apart from the route so tests can drive it with fakes.
// =====================================================================

const bodySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), durationMs: z.number().nonnegative().nullable().optional() }),
  z.object({ ok: z.literal(false), error: z.string().max(4000).nullable().optional(), logTail: z.string().max(8000).nullable().optional() }),
]);

export type CallbackDeps = {
  secret: string;
  // runs `work` as the token's space (withSpaceActor in the route)
  inSpace: <T>(claims: CallbackClaims, work: () => Promise<T>) => Promise<T>;
  // a 404 response while the Video module is off in that space, else null
  moduleOff: () => Promise<Response | null>;
  store: () => VideoStore;
  now?: () => number;
};

export async function handleRenderedCallback(request: Request, videoId: string, deps: CallbackDeps): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "Render callbacks are not configured." }, { status: 503 });
  const check = verifyCallbackToken(bearer(request.headers.get("authorization")), deps.secret, videoId, deps.now?.());
  if (!check.ok) return Response.json({ error: check.reason === "expired" ? "This callback token has expired." : "Invalid callback token." }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Send { ok: true } or { ok: false, error, logTail }." }, { status: 400 });
  }
  return deps.inSpace(check.claims, async () => {
    const off = await deps.moduleOff();
    if (off) return off;
    const { result } = await finishRender({ spaceId: check.claims.spaceId, store: deps.store() }, videoId, body);
    return Response.json({ result }, { status: result === "ignored" ? 409 : 200 });
  });
}
