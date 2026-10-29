// Generates the anonymous B-roll clips with OpenRouter's Video API (Veo 3.1 Lite, 1080p, no audio).
// Usage (from the repo root): node docs/launch-video/broll/generate.mjs [clip-name ...]
// Reads OPENROUTER_API_KEY from .env.local. Writes <name>.mp4 next to this file and appends costs to costs.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Either name works: OPENROUTER_API_KEY or OPENROUTER_KEY, with or without spaces around "="
const KEY = readFileSync(".env.local", "utf8").match(/^OPENROUTER(?:_API)?_KEY\s*=\s*(.*)$/m)[1].trim().replace(/^"|"$/g, "");
const MODEL = "google/veo-3.1-lite";
const STYLE = "Horizontal 16:9 widescreen, cinematic 35mm film look, soft film grain, muted earthy colours, shallow depth of field.";
const NO_TEXT = "No readable text anywhere, no logos, no subtitles.";
// Clean look for regenerations: Veo tends to add film-gate borders, sprocket holes and scratches for "35mm"
const CLEAN = "Horizontal 16:9 widescreen, shot on a digital cinema camera, warm cinematic grade, subtle grain, shallow depth of field. Clean full frame: no film borders, no sprocket holes, no scratches, no dust on the lens.";

// name, seconds, prompt
const CLIPS = [
  ["01-hook-bg", 4, `${CLEAN} A dark office after hours. A single monitor glows on an empty desk on the right side of the frame, showing a blurred chat window. The left half of the frame is dark and empty. Very slow dolly-in. No people. Quiet, lonely mood. ${NO_TEXT}`],
  ["03-leaving", 6, `${STYLE} Warm golden-hour light through tall office windows. Seen from behind, a person carries a cardboard box of desk items (a small plant, a mug, a folder) and walks slowly toward a glass office door. Out-of-focus colleagues at desks in the background. Static camera. The face is never shown. Bittersweet mood. ${NO_TEXT}`],
  ["05-whiteboard", 8, `${CLEAN} Warm natural window light. A small startup office. A whiteboard covered in abstract diagrams made only of boxes, circles and arrows, with no letters or words at all, and many blank sticky notes with nothing written on them, some peeling off; one blank sticky note slowly drifts to the floor. Slow push-in. No people. Cluttered, forgotten feeling. ${NO_TEXT}`],
  ["04b-empty-desk", 4, `${STYLE} Warm morning window light. An empty office desk on a quiet Monday morning. The chair is pushed in, the monitor is off, a single blank yellow sticky note on the monitor edge, an empty coat hook on the wall, a half-full mug by the keyboard. Dust floats in a sunbeam. Slow gentle push-in. No people. Calm, slightly melancholic. ${NO_TEXT}`],
  ["09-asking", 8, `${STYLE} Warm natural window light in an open office. One coworker leans over another's desk to ask a question; the seated coworker shrugs and points across the room toward someone else. Candid documentary feel, faces soft and turned partly away, slightly out of focus. Static camera with a gentle handheld feel. ${NO_TEXT}`],
  ["12-typing", 6, `${STYLE} Late evening, warm desk-lamp light. Extreme close-up of two hands typing steadily on a laptop keyboard at normal speed. Only hands and keys are visible. Repetitive, tired feeling. Realistic hands with five fingers each. ${NO_TEXT}`],
  ["14-fatigue", 4, `${STYLE} Late at night, lit only by a laptop screen. Seen from the side and slightly behind, a person at a desk slowly rubs their eyes. A cold coffee mug and scattered notebooks beside them. Face not clearly visible. Static camera. Exhausted mood. ${NO_TEXT}`],
  ["14b-network", 4, `Horizontal 16:9 widescreen, macro cinematic shot in darkness, shallow depth of field, soft bokeh, film grain. Tiny glowing points of warm amber and sage-green light appear one by one, and thin threads of light draw themselves between them, slowly forming a rotating network. Abstract, hopeful, building. No text, no logos.`],
  ["23-stays", 4, `${STYLE} Warm golden-hour light. An office glass door with no one walking through it. Dust floats in a sunbeam. On a nearby desk a laptop glows softly with a faint, unreadable network of connected dots on its screen. Slow push-in. Calm, warm, reassuring. ${NO_TEXT}`],
  ["29-endcard-bg", 4, `Horizontal 16:9 widescreen abstract background. A slow drift through a soft, out-of-focus web of warm amber and sage-green light points connected by thin lines, on a deep charcoal background. The centre of the frame is soft and uncluttered for a logo. Gentle parallax, film grain, minimal and calm. No text, no logos.`],
  // v3 cut: stock-style clips that replace the silent on-camera shots, so the only filmed shots are lip-sync
  ["s03-local-business", 4, `${CLEAN} Warm natural window light. Inside a small local business office: a few staff at desks and a counter, binders on shelves, a busy but friendly atmosphere. Slow sideways dolly. Faces soft, turned away or out of focus. ${NO_TEXT}`],
  ["s04-whiteboard", 6, `${CLEAN} Warm natural window light. A whiteboard covered only in simple boxes, circles and arrows with no letters or numbers, and blank sticky notes. A hand reaches in and adds another blank sticky note. Slow push-in. ${NO_TEXT}`],
  ["s05-notebook", 4, `${CLEAN} Warm desk light. Close-up of a hand writing quickly in a paper notebook with a pen, then pausing. Only the hand, pen and page are visible; the handwriting is soft scribbles, not readable. ${NO_TEXT}`],
  ["s11-home-laptop", 4, `${CLEAN} Evening at home, warm lamp light. Seen from behind and slightly to the side, a person sits on a sofa with a laptop on their knees, the screen glowing softly and out of focus. Static camera. Calm, determined mood. ${NO_TEXT}`],
  ["s17-laptop-open", 4, `${CLEAN} Close-up of a laptop on a wooden desk. Hands open the lid and the screen lights up with a soft glow. Morning window light. Slow push-in. ${NO_TEXT}`],
  ["s24-lean-back", 4, `${CLEAN} Warm office light. Seen from the side and behind, a person leans back in a desk chair, stretches their arms and relaxes, a laptop open in front of them. Face not visible. Relieved, satisfied mood. ${NO_TEXT}`],
];


const api = (path, init = {}) => fetch(`https://openrouter.ai/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);
const todo = CLIPS.filter(([name]) => (only.length ? only.includes(name) : !existsSync(join(HERE, `${name}.mp4`))));
const costsFile = join(HERE, "costs.json");
const costs = existsSync(costsFile) ? JSON.parse(readFileSync(costsFile, "utf8")) : {};

async function run([name, duration, prompt]) {
  const res = await api("/videos", { method: "POST", body: JSON.stringify({ model: MODEL, prompt, duration, resolution: "1080p", aspect_ratio: "16:9", generate_audio: false }) });
  const job = await res.json();
  if (!job.id) { console.log(`${name}: submit failed ${res.status} ${JSON.stringify(job).slice(0, 300)}`); return; }
  console.log(`${name}: submitted ${job.id}`);
  for (let i = 0; i < 180; i++) {
    await sleep(10000);
    const s = await (await api(`/videos/${job.id}`)).json();
    if (["completed", "failed", "cancelled", "expired"].includes(s.status)) {
      if (s.status !== "completed") { console.log(`${name}: ${s.status} ${JSON.stringify(s.error || s).slice(0, 300)}`); return; }
      const bytes = Buffer.from(await (await api(`/videos/${job.id}/content`)).arrayBuffer());
      writeFileSync(join(HERE, `${name}.mp4`), bytes);
      costs[name] = { job: job.id, model: MODEL, seconds: duration, cost: s.usage?.cost ?? null };
      writeFileSync(costsFile, JSON.stringify(costs, null, 2));
      console.log(`${name}: done, ${(bytes.length / 1e6).toFixed(1)} MB, $${s.usage?.cost ?? "?"}`);
      return;
    }
  }
  console.log(`${name}: timed out (job ${job.id} may still finish; re-run with its name)`);
}

// Budget guard: the whole B-roll job is capped at $20 (Veo 3.1 Lite 1080p, no audio: $0.05 per second)
const BUDGET = 20, PRICE_PER_SECOND = 0.05;
const spent = Object.values(costs).reduce((n, c) => n + (c.cost || 0), 0);
const estimate = todo.reduce((n, [, d]) => n + d * PRICE_PER_SECOND, 0);
if (spent + estimate > BUDGET) { console.log(`Refusing: $${spent.toFixed(2)} spent + ~$${estimate.toFixed(2)} for this run is over the $${BUDGET} budget.`); process.exit(1); }
console.log(`Budget: $${spent.toFixed(2)} spent, ~$${estimate.toFixed(2)} this run, $${BUDGET} cap`);
console.log(`Generating ${todo.length} clip(s) with ${MODEL}`);
await Promise.all(todo.map(run));
const total = Object.values(costs).reduce((n, c) => n + (c.cost || 0), 0);
console.log(`Total logged cost: $${total.toFixed(2)}`);
