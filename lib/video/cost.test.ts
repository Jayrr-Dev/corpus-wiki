import { describe, expect, it } from "vitest";
import { DEFAULT_RATES, estimateCost, formatUsd, ratesFromEnv } from "./cost";
import { scene } from "./testing";

const rates = { voiceUsdPer1kChars: 0.3, renderUsdPerHour: 0.6, renderMinutesPerVideoMinute: 2, coldStartMinutes: 2, imageUsd: 0 };

describe("cost estimate", () => {
  it("prices narration characters and the render job's minutes", () => {
    const estimate = estimateCost({ scenes: [scene("a", "x".repeat(900)), scene("b", "y".repeat(900))] }, "short", rates);
    // 1800 characters at 15 a second = 2 minutes of video → 2 + 2×2 = 6 job minutes
    expect(estimate.characters).toBe(1800);
    expect(estimate.videoMinutes).toBeCloseTo(2);
    expect(estimate.voiceUsd).toBeCloseTo(0.54);
    expect(estimate.renderUsd).toBeCloseTo(0.06);
    expect(estimate.totalUsd).toBeCloseTo(0.6);
    expect(estimate.renderMs).toBe(6 * 60_000);
  });

  it("does not charge again for scenes already voiced, and uses their real length", () => {
    const estimate = estimateCost({ scenes: [scene("a", "x".repeat(900), { audioPath: "a.mp3", durationMs: 30_000 }), scene("b", "y".repeat(300))] }, "short", rates);
    expect(estimate.characters).toBe(300);
    expect(estimate.videoMinutes).toBeCloseTo(50 / 60);
  });

  it("reads rates from the environment, ignoring bad values", () => {
    // no image model configured: graphics cost nothing
    expect(ratesFromEnv({ ELEVENLABS_USD_PER_1K_CHARS: "0.18", NEBIUS_RENDER_USD_PER_HOUR: "nope" })).toEqual({ ...DEFAULT_RATES, voiceUsdPer1kChars: 0.18, imageUsd: 0 });
  });

  it("prices each scene graphic still to draw when an image model is set up", () => {
    const withImages = ratesFromEnv({ OPENROUTER_API_KEY: "k", VIDEO_IMAGE_USD: "0.05" });
    expect(withImages.imageUsd).toBe(0.05);
    const script = { scenes: [
      { id: "a", narration: "x", title: "T", bullets: [], visual: "title" as const, sources: [] },
      { id: "b", narration: "x", title: "T", bullets: [], visual: "list" as const, sources: [], graphicPath: "drawn.png" },
      { id: "c", narration: "x", title: "T", bullets: [], visual: "diagram" as const, sources: [] },
    ] };
    expect(estimateCost(script, "short", withImages).imageUsd).toBeCloseTo(0.05);
  });

  it("reads as a rough amount", () => {
    expect(formatUsd(0.4249)).toBe("About $0.42");
    expect(formatUsd(0.004)).toBe("Under $0.01");
  });
});
