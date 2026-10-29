import type { Scene, SceneSource, VideoRow, VideoStatus } from "@/lib/video/types";
import { fakeDate, fakeId, PHOENIX_ACCOUNT } from "./core";

// =====================================================================
// PHOENIX VIDEO: the "Phoenix release in two minutes" explainer as the
// Video module stores it, at each status the video scene shows. Five
// scenes, each citing claims rebuilt from Brent's runbook and handover.
// =====================================================================

export const PHOENIX_VIDEO_TITLE = "Phoenix release in two minutes";

const claim = (key: string, title: string): SceneSource => ({ unitId: fakeId("unit", key), revisionId: fakeId("revision", key), title });

const CLAIMS = {
  freeze: claim("freeze", "Phoenix deploys only after the CAB signs off on Tuesday"),
  window: claim("window", "The release window is Friday 22:00 to Saturday 02:00"),
  rollback: claim("rollback", "Rollback restores the last tagged build in under 15 minutes"),
  ledgerly: claim("ledgerly", "Payments move from PayCore to Ledgerly in the same release"),
  owner: claim("owner", "Wes Davis owns the release after Brent left"),
};

type SceneSeed = Omit<Scene, "id" | "sources" | "audioPath" | "durationMs"> & { key: string; sources: SceneSource[]; seconds: number };

const SEEDS: SceneSeed[] = [
  {
    key: "intro", seconds: 18, visual: "title", title: "The Phoenix release", bullets: ["One release, every Friday night"],
    narration: "Phoenix ships on Friday nights, and every step of it used to live in Brent's head. Here is the whole release in two minutes.",
    graphic: "A phoenix rising over a server rack", sources: [CLAIMS.window],
  },
  {
    key: "cab", seconds: 26, visual: "list", title: "Before the window", bullets: ["CAB signs off on Tuesday", "Freeze on Thursday noon", "Patty posts the change list"],
    narration: "Nothing deploys until the change advisory board signs off on Tuesday. The code freezes on Thursday at noon, and Patty posts the final change list.",
    graphic: "A checklist with three ticked boxes", sources: [CLAIMS.freeze],
  },
  {
    key: "window", seconds: 28, visual: "diagram", title: "Release night", bullets: ["22:00 deploy starts", "Smoke tests on checkout", "02:00 window closes"],
    narration: "The window opens at ten. The deploy runs, smoke tests hit checkout, and by two in the morning the window closes, shipped or rolled back.",
    graphic: null, sources: [CLAIMS.window],
  },
  {
    key: "ledgerly", seconds: 24, visual: "list", title: "PayCore to Ledgerly", bullets: ["Payments switch in the same release", "Watch declines at peak"],
    narration: "This release also moves payments from PayCore to Ledgerly. Watch the decline rate during the first peak hour.",
    graphic: "Two payment terminals with an arrow between them", sources: [CLAIMS.ledgerly],
  },
  {
    key: "rollback", seconds: 22, visual: "quote", title: "If it goes wrong", bullets: ["Roll back the last tagged build", "Wes owns the call"],
    narration: "If checkout breaks, roll back to the last tagged build. It takes under fifteen minutes, and Wes makes the call now.",
    graphic: "A rewind button on a dashboard", sources: [CLAIMS.rollback, CLAIMS.owner],
  },
];

// Each scene as the script editor sees it (not voiced yet), or voiced with its length
function scenes(voiced: number): Scene[] {
  return SEEDS.map(({ key, seconds, ...rest }, index) => ({
    ...rest,
    id: fakeId("video-scene", key),
    assetId: null,
    audioPath: index < voiced ? `videos/phoenix/${key}.mp3` : null,
    durationMs: index < voiced ? seconds * 1000 : null,
  }));
}

export const PHOENIX_VIDEO_SCENE_COUNT = SEEDS.length;

const BASE: VideoRow = {
  id: fakeId("video", "phoenix-release"),
  title: PHOENIX_VIDEO_TITLE,
  scopeKind: "topic",
  scopeId: fakeId("topic", "phoenix-release"),
  coverage: 100,
  claimIds: null,
  length: "medium",
  voiceId: "stage-voice",
  status: "script",
  script: { scenes: scenes(0) },
  durationMs: null,
  videoPath: null,
  posterPath: null,
  renderJobId: null,
  error: null,
  createdBy: PHOENIX_ACCOUNT.id,
  createdAt: fakeDate("2026-04-07", "10:12"),
  statusChangedAt: fakeDate("2026-04-07", "10:12"),
};

// The video at a status; `voiced` scenes have audio (voicing fills them one by one)
export function phoenixVideo(status: VideoStatus, voiced = status === "script" || status === "voicing" ? 0 : SEEDS.length): VideoRow {
  const ready = status === "ready";
  return {
    ...BASE,
    status,
    script: { scenes: scenes(voiced) },
    renderJobId: status === "rendering" || ready ? "nebius-job-phoenix-01" : null,
    durationMs: ready ? SEEDS.reduce((sum, seed) => sum + seed.seconds * 1000, 0) : null,
    videoPath: ready ? "videos/phoenix/phoenix-release.mp4" : null,
    posterPath: ready ? "videos/phoenix/phoenix-release.jpg" : null,
  };
}

// THE PLAYER'S FIRST FRAME: a plain branded title card, as the render's first scene draws it
const POSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1729"/><stop offset="1" stop-color="#1e1b3a"/></linearGradient>
<radialGradient id="r" cx="0.78" cy="0.3" r="0.6"><stop offset="0" stop-color="#f97316" stop-opacity="0.35"/><stop offset="1" stop-color="#f97316" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#r)"/>
<text x="96" y="132" font-family="Inter, Segoe UI, sans-serif" font-size="26" fill="#cbd5e1" letter-spacing="3">PARTS UNLIMITED · IT OPERATIONS</text>
<text x="96" y="330" font-family="Inter, Segoe UI, sans-serif" font-size="84" font-weight="700" fill="#ffffff">The Phoenix release</text>
<text x="96" y="410" font-family="Inter, Segoe UI, sans-serif" font-size="40" fill="#e2e8f0">One release, every Friday night</text>
<rect x="96" y="460" width="120" height="6" rx="3" fill="#f97316"/>
<text x="96" y="540" font-family="Inter, Segoe UI, sans-serif" font-size="24" fill="#94a3b8">Corpus Wiki · from Brent's runbook and handover</text>
</svg>`;

export const PHOENIX_VIDEO_POSTER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(POSTER_SVG)}`;

// A one-second 16x16 black MP4, so the player loads (no spinner) and keeps showing the poster
export const PHOENIX_VIDEO_FILE = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMVbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAAg8SJZYAQAGaOvjxMhM/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABZAAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALIAAAAAQAAABRzdGNvAAAAAAAAAAEAAANFAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAAAtBtZGF0AAACrwYF//+r3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOi0zOi0zIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0yLjAwOjAuNzAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS00IHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMjAAgAAAABFliIQAF85//vfUt8yy7gcjgQ==";
