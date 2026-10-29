// Tiny time-driven animation engine. A scene defines window.SCENE = { duration, setup(), frame(t) }.
// frame(t) must draw the whole scene for time t (seconds) without depending on earlier frames,
// so the renderer can ask for any exact frame (the same idea as HyperFrames).

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
// progress 0→1 between times a and b
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a, b, p) => a + (b - a) * p;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
// first element whose own text is exactly `text`
const byText = (text, sel = "*") => $$(sel).find((el) => el.textContent.trim() === text);

// Typewriter: the first n characters of text for progress p
const typed = (text, p) => text.slice(0, Math.round(text.length * clamp(p)));

// Slow camera push-in over the whole scene (scales the page body)
function camera(t, dur, from = 1.0, to = 1.045, ox = "50%", oy = "50%") {
  const s = document.body;
  s.style.transformOrigin = `${ox} ${oy}`;
  s.style.transform = `scale(${lerp(from, to, easeInOut(seg(t, 0, dur)))})`;
}

// Cursor along keyframes [[time, x, y], ...]; clicks: [time, ...] press it and pulse a ring
function cursor(t, keys, clicks = []) {
  const c = $("#cursor");
  let x = keys[0][1], y = keys[0][2];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, xa, ya] = keys[i], [tb, xb, yb] = keys[i + 1];
    if (t >= ta && t <= tb) { const p = easeInOut(seg(t, ta, tb)); x = lerp(xa, xb, p); y = lerp(ya, yb, p); }
    else if (t > tb) { x = xb; y = yb; }
  }
  c.style.left = x + "px"; c.style.top = y + "px";
  const ring = c.querySelector(".ring");
  let o = 0, sc = 1;
  for (const ct of clicks) { const p = seg(t, ct, ct + 0.45); if (p > 0 && p < 1) { o = 1 - p; sc = 1 + p * 1.3; } }
  ring.style.opacity = o; ring.style.transform = `scale(${sc})`;
  c.querySelector("svg").style.transform = clicks.some((ct) => t >= ct && t < ct + 0.13) ? "scale(.86)" : "none";
}

// Hover / press state for an element: hovered between a and b, pressed just after click time c
function press(el, t, a, b, c) {
  if (!el) return;
  const hover = t >= a && t <= b;
  const down = c !== undefined && t >= c && t < c + 0.14;
  el.style.filter = hover ? "brightness(1.25)" : "";
  el.style.transform = down ? "scale(.96)" : "";
  el.style.transition = "none";
}

const CURSOR_HTML = `<div id="cursor" style="position:absolute;z-index:9999;width:30px;height:30px;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">
<div class="ring" style="position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;border:2px solid #8fae8d;opacity:0"></div>
<svg viewBox="0 0 24 24" style="width:100%;height:100%;transform-origin:4px 3px"><path d="M4 3 L4 19 L8.5 15 L11.5 21.5 L14 20.3 L11 14 L17 14 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg></div>`;

// Preview in a normal browser: loops the scene. The renderer adds ?render and calls frame(t) itself.
window.addEventListener("load", () => {
  document.body.style.position = "relative";
  if (window.SCENE?.setup) SCENE.setup();
  document.body.insertAdjacentHTML("beforeend", CURSOR_HTML);
  if (location.search.includes("render")) { window.__ready = true; return; }
  document.fonts.ready.then(() => {
    const start = performance.now();
    const loop = (now) => { const t = ((now - start) / 1000) % (SCENE.duration + 0.8); SCENE.frame(Math.min(t, SCENE.duration)); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
});
