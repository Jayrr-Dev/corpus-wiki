import { LENGTH_PLAN, type VideoLength, type VideoScript } from "./types";

// =====================================================================
// COST ESTIMATE shown beside Make video, before anything costs money.
//   Voice   ElevenLabs bills per character of narration
//   Render  Nebius bills the CPU job's VM only while it runs: cold start
//           plus render time per minute of video
// The rates are starting points until the spikes (S1, S2) record real
// ones; the server can override each with an environment variable.
// =====================================================================

export type CostRates = {
  voiceUsdPer1kChars: number;
  renderUsdPerHour: number;
  renderMinutesPerVideoMinute: number;
  coldStartMinutes: number;
};

export const DEFAULT_RATES: CostRates = {
  voiceUsdPer1kChars: 0.3,
  renderUsdPerHour: 0.2,
  renderMinutesPerVideoMinute: 2,
  coldStartMinutes: 2,
};

const positive = (value: string | undefined, fallback: number) => {
  const number = Number(value);
  return value && Number.isFinite(number) && number >= 0 ? number : fallback;
};

export function ratesFromEnv(env: Record<string, string | undefined>): CostRates {
  return {
    voiceUsdPer1kChars: positive(env.ELEVENLABS_USD_PER_1K_CHARS, DEFAULT_RATES.voiceUsdPer1kChars),
    renderUsdPerHour: positive(env.NEBIUS_RENDER_USD_PER_HOUR, DEFAULT_RATES.renderUsdPerHour),
    renderMinutesPerVideoMinute: positive(env.NEBIUS_RENDER_MINUTES_PER_VIDEO_MINUTE, DEFAULT_RATES.renderMinutesPerVideoMinute),
    coldStartMinutes: positive(env.NEBIUS_RENDER_COLD_START_MINUTES, DEFAULT_RATES.coldStartMinutes),
  };
}

export type CostEstimate = { characters: number; videoMinutes: number; voiceUsd: number; renderUsd: number; totalUsd: number; renderMs: number };

// Narration speed used to guess a scene's length before it is voiced
export const CHARS_PER_SECOND = 15;

// Voice and render cost for a script; scenes already voiced cost nothing again
export function estimateCost(script: VideoScript, length: VideoLength, rates: CostRates = DEFAULT_RATES): CostEstimate {
  const unvoiced = script.scenes.filter((scene) => !scene.audioPath);
  const characters = unvoiced.reduce((sum, scene) => sum + scene.narration.length, 0);
  const spokenMs = script.scenes.reduce((sum, scene) => sum + (scene.durationMs ?? (scene.narration.length / CHARS_PER_SECOND) * 1000), 0);
  const videoMinutes = script.scenes.length ? spokenMs / 60_000 : LENGTH_PLAN[length].seconds / 60;
  const renderMinutes = rates.coldStartMinutes + videoMinutes * rates.renderMinutesPerVideoMinute;
  const voiceUsd = (characters / 1000) * rates.voiceUsdPer1kChars;
  const renderUsd = (renderMinutes / 60) * rates.renderUsdPerHour;
  return { characters, videoMinutes, voiceUsd, renderUsd, totalUsd: voiceUsd + renderUsd, renderMs: renderMinutes * 60_000 };
}

// "About $0.42"; under a cent reads "Under $0.01"
export function formatUsd(usd: number): string {
  if (usd < 0.01) return "Under $0.01";
  return `About $${usd.toFixed(2)}`;
}
