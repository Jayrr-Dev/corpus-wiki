import { describe, expect, it } from "vitest";
import { type CallbackDeps, handleRenderedCallback } from "./callback";
import { MemoryStore, SPACE_ID, VIDEO_ID, videoRow } from "./testing";
import { signCallbackToken } from "./token";
import type { VideoRow } from "./types";

const NOW = Date.parse("2026-10-29T10:05:00.000Z");
const SECRET = "callback-secret";
const token = (extra: Partial<{ videoId: string; exp: number }> = {}, secret = SECRET) => signCallbackToken({ videoId: VIDEO_ID, spaceId: SPACE_ID, exp: NOW + 60_000, ...extra }, secret);

function setup(row: Partial<VideoRow> = { status: "rendering" }, moduleOn = true) {
  const store = new MemoryStore([videoRow(row)], () => NOW);
  const spaces: string[] = [];
  const deps: CallbackDeps = {
    secret: SECRET,
    inSpace: (claims, work) => { spaces.push(claims.spaceId); return work(); },
    moduleOff: async () => (moduleOn ? null : Response.json({ error: "Not found." }, { status: 404 })),
    store: () => store,
    now: () => NOW,
  };
  return { store, spaces, deps };
}

const post = (body: unknown, auth: string | null) =>
  new Request(`https://app.test/api/video/${VIDEO_ID}/rendered`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

describe("render callback route", () => {
  it("marks the video ready with a valid token, writing in the token's space", async () => {
    const { store, spaces, deps } = setup();
    const response = await handleRenderedCallback(post({ ok: true, durationMs: 30_500 }, `Bearer ${token()}`), VIDEO_ID, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "ready" });
    expect(spaces).toEqual([SPACE_ID]);
    expect(store.rows.get(VIDEO_ID)).toMatchObject({ status: "ready", durationMs: 30_500 });
  });

  it("marks the video failed when the job reports an error", async () => {
    const { store, deps } = setup();
    const response = await handleRenderedCallback(post({ ok: false, error: "Render failed", logTail: "tail" }, `Bearer ${token()}`), VIDEO_ID, deps);
    expect(await response.json()).toEqual({ result: "failed" });
    expect(store.rows.get(VIDEO_ID)).toMatchObject({ status: "failed", error: "Render failed\ntail" });
  });

  it.each([
    ["no token", null],
    ["a token signed with another secret", `Bearer ${token({}, "wrong")}`],
    ["a token for another video", `Bearer ${token({ videoId: "other" })}`],
    ["an expired token", `Bearer ${token({ exp: NOW - 1 })}`],
    ["a garbled token", "Bearer abc"],
  ])("refuses %s with 401 and changes nothing", async (_name, auth) => {
    const { store, spaces, deps } = setup();
    const response = await handleRenderedCallback(post({ ok: true }, auth), VIDEO_ID, deps);
    expect(response.status).toBe(401);
    expect(spaces).toEqual([]);
    expect(store.rows.get(VIDEO_ID)!.status).toBe("rendering");
  });

  it("answers 503 when no secret is configured", async () => {
    const { deps } = setup();
    expect((await handleRenderedCallback(post({ ok: true }, `Bearer ${token()}`), VIDEO_ID, { ...deps, secret: "" })).status).toBe(503);
  });

  it("refuses a body that is neither success nor failure", async () => {
    const { deps } = setup();
    expect((await handleRenderedCallback(post({ done: 1 }, `Bearer ${token()}`), VIDEO_ID, deps)).status).toBe(400);
  });

  it("answers 404 while the Video module is off", async () => {
    const { store, deps } = setup({ status: "rendering" }, false);
    expect((await handleRenderedCallback(post({ ok: true }, `Bearer ${token()}`), VIDEO_ID, deps)).status).toBe(404);
    expect(store.rows.get(VIDEO_ID)!.status).toBe("rendering");
  });

  it("answers 409 to a late callback after a timeout", async () => {
    const { store, deps } = setup({ status: "failed", error: "timed out" });
    expect((await handleRenderedCallback(post({ ok: true }, `Bearer ${token()}`), VIDEO_ID, deps)).status).toBe(409);
    expect(store.rows.get(VIDEO_ID)!.status).toBe("failed");
  });
});
