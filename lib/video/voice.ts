import type { Caption, Scene, VoiceOption } from "./types";

// =====================================================================
// VOICE: narration per scene from ElevenLabs
// (POST /v1/text-to-speech/{voice_id}/with-timestamps). It returns the
// audio and the time of each character, so a scene's length comes from
// its audio and captions line up with the words. The previous scene's
// text goes in as previous_text so the voice stays even across scenes.
// Key: ELEVENLABS_API_KEY on the server. Everything here talks to the
// VoiceClient interface; tests pass a fake, never the network.
// =====================================================================

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
export const DEFAULT_VOICE_MODEL = "eleven_multilingual_v2";
// "Rachel", a premade voice every account has; the spike (S1) confirms the pick
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const AUDIO_FORMAT = "mp3_44100_128";

// Character timings, as ElevenLabs returns them
export type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

export type SpeechRequest = { voiceId: string; text: string; previousText?: string | null; nextText?: string | null; modelId?: string };
export type Speech = { audio: Uint8Array; alignment: Alignment };

export interface VoiceClient {
  speak(request: SpeechRequest): Promise<Speech>;
  voices(): Promise<VoiceOption[]>;
}

export class VoiceError extends Error {}

type Fetch = typeof fetch;

// The ElevenLabs client; `fetchImpl` is the network (a fake in tests)
export function elevenLabsClient(apiKey: string, options: { fetchImpl?: Fetch; baseUrl?: string; modelId?: string } = {}): VoiceClient {
  if (!apiKey) throw new VoiceError("Add ELEVENLABS_API_KEY to the server environment to voice videos.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? ELEVENLABS_BASE_URL;
  const headers = { "xi-api-key": apiKey, "content-type": "application/json", accept: "application/json" };

  const failed = async (response: Response, what: string) => {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    return new VoiceError(`ElevenLabs could not ${what} (${response.status})${detail ? `: ${detail}` : "."}`);
  };

  return {
    async speak({ voiceId, text, previousText, nextText, modelId }) {
      const url = `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${AUDIO_FORMAT}`;
      const body = { text, model_id: modelId ?? options.modelId ?? DEFAULT_VOICE_MODEL, ...(previousText ? { previous_text: previousText } : {}), ...(nextText ? { next_text: nextText } : {}) };
      const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!response.ok) throw await failed(response, "voice a scene");
      const json = (await response.json()) as { audio_base64?: string; alignment?: Alignment | null };
      if (!json.audio_base64 || !json.alignment) throw new VoiceError("ElevenLabs answered without audio or timings.");
      return { audio: new Uint8Array(Buffer.from(json.audio_base64, "base64")), alignment: json.alignment };
    },
    async voices() {
      const response = await fetchImpl(`${baseUrl}/v1/voices`, { headers });
      if (!response.ok) throw await failed(response, "list voices");
      const json = (await response.json()) as { voices?: { voice_id: string; name: string; preview_url?: string | null }[] };
      return (json.voices ?? []).map((voice) => ({ id: voice.voice_id, name: voice.name, previewUrl: voice.preview_url ?? null }));
    },
  };
}

// Pause after each scene before the next one starts
export const SCENE_TAIL_MS = 400;

// A scene's length: the end of its last character plus a short pause
export function durationFromAlignment(alignment: Alignment): number {
  const ends = alignment.character_end_times_seconds;
  const last = ends.length ? Math.max(...ends) : 0;
  return Math.round(last * 1000) + SCENE_TAIL_MS;
}

// Words with their times, from character timings
export function wordsFromAlignment(alignment: Alignment): Caption[] {
  const words: Caption[] = [];
  let current: Caption | null = null;
  alignment.characters.forEach((char, index) => {
    const start = Math.round((alignment.character_start_times_seconds[index] ?? 0) * 1000);
    const end = Math.round((alignment.character_end_times_seconds[index] ?? 0) * 1000);
    if (/\s/.test(char)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (current) {
      current.text += char;
      current.endMs = end;
    } else current = { text: char, startMs: start, endMs: end };
  });
  if (current) words.push(current);
  return words;
}

// Caption lines of a few words each, broken after sentence ends
export function captionsFromAlignment(alignment: Alignment, wordsPerLine = 7): Caption[] {
  const lines: Caption[] = [];
  let line: Caption | null = null;
  let count = 0;
  for (const word of wordsFromAlignment(alignment)) {
    if (line) {
      line.text += ` ${word.text}`;
      line.endMs = word.endMs;
    } else line = { ...word };
    count += 1;
    if (count >= wordsPerLine || /[.!?]["')\]]?$/.test(word.text)) {
      lines.push(line);
      line = null;
      count = 0;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Where a scene's audio is stored: <space>/<video>/audio/<scene>.mp3 in the videos bucket
export const sceneAudioPath = (spaceId: string, videoId: string, sceneId: string) => `${spaceId}/${videoId}/audio/${sceneId}.mp3`;

// VOICE EVERY SCENE in order. Scenes that already have audio are kept (Try again does not pay twice).
// `save` stores the audio and returns its path; `onScene` records each voiced scene as it lands.
export async function voiceScenes(input: {
  scenes: readonly Scene[];
  voiceId: string;
  client: VoiceClient;
  save: (scene: Scene, audio: Uint8Array) => Promise<string>;
  onScene?: (scenes: Scene[]) => Promise<void>;
}): Promise<Scene[]> {
  const scenes = input.scenes.map((scene) => ({ ...scene }));
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]!;
    if (scene.audioPath && scene.durationMs) continue;
    if (!scene.narration.trim()) throw new VoiceError(`Scene ${index + 1} has no narration.`);
    const speech = await input.client.speak({
      voiceId: input.voiceId,
      text: scene.narration,
      previousText: scenes[index - 1]?.narration ?? null,
      nextText: scenes[index + 1]?.narration ?? null,
    });
    scenes[index] = { ...scene, audioPath: await input.save(scene, speech.audio), durationMs: durationFromAlignment(speech.alignment), captions: captionsFromAlignment(speech.alignment) };
    await input.onScene?.(scenes.map((item) => ({ ...item })));
  }
  return scenes;
}

// Clears what voicing set, after the narration changes
export function clearVoice(scene: Scene): Scene {
  return { ...scene, audioPath: null, durationMs: null, captions: null };
}
