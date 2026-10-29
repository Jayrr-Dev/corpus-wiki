import { describe, expect, it, vi } from "vitest";
import { alignmentFor, FakeVoice, scene } from "./testing";
import { captionsFromAlignment, clearVoice, DEFAULT_VOICE_MODEL, durationFromAlignment, elevenLabsClient, SCENE_TAIL_MS, VoiceError, voiceScenes, wordsFromAlignment } from "./voice";

// A fetch that answers from a function and records each call (no network)
function fakeFetch(answer: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("ElevenLabs client", () => {
  it("calls with-timestamps with the key, model and previous_text, and decodes the audio", async () => {
    const alignment = alignmentFor("Hi.");
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ audio_base64: Buffer.from("mp3-bytes").toString("base64"), alignment }));
    const client = elevenLabsClient("key-1", { fetchImpl });
    const speech = await client.speak({ voiceId: "voice/1", text: "Hi.", previousText: "Before." });

    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice%2F1/with-timestamps?output_format=mp3_44100_128");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>)["xi-api-key"]).toBe("key-1");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ text: "Hi.", model_id: DEFAULT_VOICE_MODEL, previous_text: "Before." });
    expect(Buffer.from(speech.audio).toString()).toBe("mp3-bytes");
    expect(speech.alignment).toEqual(alignment);
  });

  it("leaves previous_text out for the first scene", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ audio_base64: "", alignment: alignmentFor("a") }));
    await elevenLabsClient("k", { fetchImpl }).speak({ voiceId: "v", text: "a" }).catch(() => {});
    expect(JSON.parse(String(calls[0]!.init?.body))).not.toHaveProperty("previous_text");
  });

  it("turns an error answer into a VoiceError with the status", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("quota exceeded", { status: 429 }));
    await expect(elevenLabsClient("k", { fetchImpl }).speak({ voiceId: "v", text: "a" })).rejects.toThrow(/ElevenLabs could not voice a scene \(429\): quota exceeded/);
  });

  it("refuses an answer without timings", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ audio_base64: "AAAA" }));
    await expect(elevenLabsClient("k", { fetchImpl }).speak({ voiceId: "v", text: "a" })).rejects.toThrow(VoiceError);
  });

  it("lists voices with their preview clips", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ voices: [{ voice_id: "v1", name: "Ana", preview_url: "https://p/1.mp3" }, { voice_id: "v2", name: "Ben" }] }));
    expect(await elevenLabsClient("k", { fetchImpl }).voices()).toEqual([{ id: "v1", name: "Ana", previewUrl: "https://p/1.mp3" }, { id: "v2", name: "Ben", previewUrl: null }]);
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/voices");
  });

  it("needs a key", () => {
    expect(() => elevenLabsClient("")).toThrow("ELEVENLABS_API_KEY");
  });
});

describe("timings", () => {
  it("takes a scene's length from its last character plus a pause", () => {
    expect(durationFromAlignment(alignmentFor("abcd"))).toBe(200 + SCENE_TAIL_MS);
  });

  it("groups characters into timed words", () => {
    expect(wordsFromAlignment(alignmentFor("Hi you"))).toEqual([{ text: "Hi", startMs: 0, endMs: 100 }, { text: "you", startMs: 150, endMs: 300 }]);
  });

  it("breaks captions after sentences and long lines", () => {
    const lines = captionsFromAlignment(alignmentFor("One two. Three four five six"), 3);
    expect(lines.map((line) => line.text)).toEqual(["One two.", "Three four five", "six"]);
    expect(lines[0]).toMatchObject({ startMs: 0, endMs: 400 });
  });
});

describe("voicing scenes", () => {
  it("voices each scene in order with the previous and next scene's text", async () => {
    const voice = new FakeVoice();
    const saved: string[] = [];
    const scenes = await voiceScenes({
      scenes: [scene("a", "First."), scene("b", "Second."), scene("c", "Third.")],
      voiceId: "voice-1",
      client: voice,
      save: async (item) => { saved.push(item.id); return `audio/${item.id}.mp3`; },
    });
    expect(voice.requests.map((request) => [request.text, request.previousText, request.nextText])).toEqual([
      ["First.", null, "Second."],
      ["Second.", "First.", "Third."],
      ["Third.", "Second.", null],
    ]);
    expect(saved).toEqual(["a", "b", "c"]);
    expect(scenes[1]).toMatchObject({ audioPath: "audio/b.mp3", durationMs: 7 * 50 + SCENE_TAIL_MS, captions: [{ text: "Second.", startMs: 0, endMs: 350 }] });
  });

  it("keeps scenes already voiced and reports each new one", async () => {
    const voice = new FakeVoice();
    const reports: number[] = [];
    await voiceScenes({
      scenes: [scene("a", "Done.", { audioPath: "audio/a.mp3", durationMs: 900 }), scene("b", "New.")],
      voiceId: "v",
      client: voice,
      save: async (item) => `audio/${item.id}.mp3`,
      onScene: async (current) => { reports.push(current.filter((item) => item.audioPath).length); },
    });
    expect(voice.requests.map((request) => request.text)).toEqual(["New."]);
    expect(voice.requests[0]!.previousText).toBe("Done.");
    expect(reports).toEqual([2]);
  });

  it("refuses an empty narration", async () => {
    await expect(voiceScenes({ scenes: [scene("a", "  ")], voiceId: "v", client: new FakeVoice(), save: async () => "x" })).rejects.toThrow("Scene 1 has no narration.");
  });

  it("clears voicing", () => {
    expect(clearVoice(scene("a", "x", { audioPath: "p", durationMs: 5, captions: [] }))).toMatchObject({ audioPath: null, durationMs: null, captions: null });
  });
});
