// Makes clean 16:9 stills of the presenter (from reference.webp) for the lip-synced avatar lines.
// Uses OpenRouter's google/gemini-nano-banana-2.1. Usage (repo root): node docs/launch-video/avatar/make_stills.mjs [name ...]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = readFileSync(".env.local", "utf8").match(/^OPENROUTER_API_KEY=(.*)$/m)[1].trim().replace(/^"|"$/g, "");
const MODEL = "google/gemini-nano-banana-2.1";
const REF = `data:image/webp;base64,${readFileSync(join(HERE, "reference.webp")).toString("base64")}`;

const PERSON = "The man in the reference photo, with exactly his face, hair and build: short dark hair faded on the sides and swept back, clean-shaven, warm friendly expression. He wears a dark navy button-up shirt with sleeves rolled to the forearm and a silver watch.";
const LOOK = "Photorealistic, horizontal 16:9 widescreen, shot on a modern digital cinema camera, clean and sharp, natural colours, soft daylight, modern commercial look. No film grain, no vignette, no borders, no text, no logos.";
const STILLS = [
  ["desk", `${PERSON} He sits at a light wooden desk with an open laptop in a bright, modern, minimal home office, a large window with soft daylight on the left of the frame. He is on the right third of the frame, chest up, facing the camera directly, looking straight into the lens with a relaxed, knowing half-smile, mouth closed. His face is evenly lit from the front. ${LOOK}`],
  ["floor", `${PERSON} He sits casually on a soft cream rug on a living-room floor, leaning back against the front of a sofa, knees up, arms relaxed. Chest-up framing, upright head, facing the camera directly with a warm, easy smile, mouth closed. Warm late-afternoon sunlight, a low bookshelf and plants softly out of focus behind him. His face is evenly lit and fully visible. ${LOOK}`],
];

const only = process.argv.slice(2);
for (const [name, prompt] of STILLS.filter(([n]) => !only.length || only.includes(n))) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, modalities: ["image", "text"], image_config: { aspect_ratio: "16:9" },
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: REF } }] }] }),
  });
  const j = await res.json();
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) { console.log(`${name}: no image (${res.status}) ${JSON.stringify(j).slice(0, 300)}`); continue; }
  const out = join(HERE, `still-${name}.png`);
  writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log(`${name}: ${out} · cost $${j.usage?.cost ?? "?"}`);
}
