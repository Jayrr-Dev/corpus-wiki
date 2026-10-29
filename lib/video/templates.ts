import type { Scene, SceneVisual } from "./types";

// =====================================================================
// SCENE TEMPLATES: our own small set of HyperFrames scenes, in the app's
// look (Inter, a warm off-white page, ink text, one blue accent). Each
// template returns the HTML inside one scene clip; compose.ts places the
// clips on the timeline and animates them. 1920×1080, 30 fps.
//   title    a large heading, the bullets as a subtitle line
//   list     heading and up to five bullets that appear one by one
//   quote    the first bullet as a pull quote under the heading (or the heading alone)
//   diagram  bullets as connected boxes, left to right
//   image    an image from Assets beside the heading and bullets
// A scene with a picture (its Assets image or its drawn graphic) shows the
// text on the left and the picture on the right, whatever its visual; a
// diagram keeps its boxes.
// =====================================================================

export const FRAME = { width: 1920, height: 1080, fps: 30 } as const;

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Shared styles for every scene (inlined into the composition)
export const SCENE_CSS = `
:root { --page: #faf9f6; --ink: #1c1b19; --muted: #6b6862; --accent: #2563eb; --line: #e4e1da; }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${FRAME.width}px; height: ${FRAME.height}px; background: var(--page); overflow: hidden; }
body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: var(--ink); }
.scene { position: absolute; inset: 0; padding: 120px 160px 200px; display: flex; flex-direction: column; justify-content: center; gap: 48px; }
.scene h1 { font-size: 88px; line-height: 1.05; font-weight: 700; letter-spacing: -0.02em; max-width: 1500px; }
.scene h2 { font-size: 64px; line-height: 1.1; font-weight: 650; letter-spacing: -0.01em; }
.scene .sub { font-size: 40px; color: var(--muted); max-width: 1400px; }
.scene ul { list-style: none; padding: 0; display: grid; gap: 28px; }
.scene li { font-size: 44px; line-height: 1.25; padding-left: 48px; position: relative; }
.scene li::before { content: ""; position: absolute; left: 0; top: 0.45em; width: 18px; height: 18px; border-radius: 4px; background: var(--accent); }
.scene blockquote { font-size: 68px; line-height: 1.2; font-weight: 600; border-left: 12px solid var(--accent); padding-left: 56px; max-width: 1500px; }
.scene .cite { font-size: 36px; color: var(--muted); padding-left: 68px; }
.scene .flow { display: flex; align-items: center; gap: 32px; flex-wrap: nowrap; }
.scene .node { flex: 1 1 0; min-height: 220px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 32px; border: 3px solid var(--line); border-radius: 24px; background: #fff; font-size: 36px; line-height: 1.25; }
.scene .arrow { width: 56px; height: 4px; background: var(--accent); flex: none; position: relative; }
.scene .arrow::after { content: ""; position: absolute; right: -4px; top: -10px; border: 12px solid transparent; border-left: 16px solid var(--accent); }
.scene.with-image { flex-direction: row; align-items: center; gap: 80px; }
.scene.with-image .text { flex: 1; display: flex; flex-direction: column; gap: 40px; }
.scene.with-image img { width: 760px; height: 760px; object-fit: cover; border-radius: 32px; flex: none; }
.scene.with-image h1 { font-size: 76px; }
.scene.with-image blockquote { font-size: 56px; }
.caption { position: absolute; left: 160px; right: 160px; bottom: 64px; text-align: center; font-size: 40px; line-height: 1.3; color: #fff; }
.caption span { background: rgba(28, 27, 25, 0.82); padding: 8px 20px; border-radius: 12px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
`;

const bulletsOf = (scene: Scene, max: number) => scene.bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, max);

type Render = (scene: Scene, image: string | null) => string;

const TEMPLATES: Record<SceneVisual, Render> = {
  title: (scene) => {
    const sub = bulletsOf(scene, 3).join(" · ");
    return `<div class="scene title"><h1 data-animate>${escapeHtml(scene.title)}</h1>${sub ? `<p class="sub" data-animate>${escapeHtml(sub)}</p>` : ""}</div>`;
  },
  list: (scene) => `<div class="scene list"><h2 data-animate>${escapeHtml(scene.title)}</h2><ul>${bulletsOf(scene, 5).map((bullet) => `<li data-animate>${escapeHtml(bullet)}</li>`).join("")}</ul></div>`,
  quote: (scene) => {
    const [quote] = bulletsOf(scene, 1);
    return `<div class="scene quote"><blockquote data-animate>${escapeHtml(quote ?? scene.title)}</blockquote>${quote ? `<p class="cite" data-animate>${escapeHtml(scene.title)}</p>` : ""}</div>`;
  },
  diagram: (scene) => {
    const nodes = bulletsOf(scene, 4);
    const flow = nodes.map((node) => `<div class="node" data-animate>${escapeHtml(node)}</div>`).join(`<div class="arrow" data-animate></div>`);
    return `<div class="scene diagram"><h2 data-animate>${escapeHtml(scene.title)}</h2><div class="flow">${flow}</div></div>`;
  },
  image: (scene, image) => {
    if (!image) return TEMPLATES.list(scene, null);
    return `<div class="scene with-image"><div class="text"><h2 data-animate>${escapeHtml(scene.title)}</h2><ul>${bulletsOf(scene, 3).map((bullet) => `<li data-animate>${escapeHtml(bullet)}</li>`).join("")}</ul></div><img data-animate src="${escapeHtml(image)}" alt="" /></div>`;
  },
};

// A scene's text beside its picture, keeping the visual's own heading style
function withPicture(scene: Scene, image: string): string {
  const picture = `<img data-animate src="${escapeHtml(image)}" alt="" />`;
  if (scene.visual === "title") {
    const sub = bulletsOf(scene, 3).join(" · ");
    return `<div class="scene with-image"><div class="text"><h1 data-animate>${escapeHtml(scene.title)}</h1>${sub ? `<p class="sub" data-animate>${escapeHtml(sub)}</p>` : ""}</div>${picture}</div>`;
  }
  if (scene.visual === "quote") {
    const [quote] = bulletsOf(scene, 1);
    return `<div class="scene with-image"><div class="text"><blockquote data-animate>${escapeHtml(quote ?? scene.title)}</blockquote>${quote ? `<p class="cite" data-animate>${escapeHtml(scene.title)}</p>` : ""}</div>${picture}</div>`;
  }
  return TEMPLATES.image(scene, image);
}

// The HTML for one scene's visual; `image` is its picture's file name in the composition, if any
export function renderSceneTemplate(scene: Scene, image: string | null = null): string {
  if (image && scene.visual !== "diagram") return withPicture(scene, image);
  return (TEMPLATES[scene.visual] ?? TEMPLATES.list)(scene, image);
}
