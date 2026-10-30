// Shared timeline helpers for concepts 7 and 8: timed steps that loop,
// word-by-word writing, and a gentle pointer tilt on the 3D scene.
export const $ = (id) => document.getElementById(id);
export const toggle = (el, cls, v = true) => el.classList.toggle(cls, v);
export const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

// LOOP: run the steps, fade the scene, reset, run again
export function loop(length, reset, steps) {
  let timers = [];
  const run = () => {
    timers.forEach(clearTimeout); timers = [];
    reset(); toggle($("scene"), "fading", false);
    steps((ms, fn) => timers.push(setTimeout(fn, ms)));
    timers.push(setTimeout(() => toggle($("scene"), "fading"), length - 500));
    timers.push(setTimeout(run, length));
  };
  demoFontsReady.then(run);
}

// WRITE: put text into an element word by word, with a caret while it grows
export function write(el, html, perWord = 45, done) {
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  el.innerHTML = "";
  const words = [];
  tmp.childNodes.forEach((node) => {
    if (node.nodeType === 3) node.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) { el.append(part); return; }
      const s = document.createElement("span"); s.className = "w"; s.textContent = part; el.append(s); words.push(s);
    });
    else { const n = node.cloneNode(true); n.classList.add("w"); el.append(n); words.push(n); }
  });
  const caret = document.createElement("span"); caret.className = "caret"; el.append(caret);
  if (reduce) { words.forEach((w) => w.classList.add("on")); caret.remove(); done?.(); return; }
  words.forEach((w, i) => setTimeout(() => { w.classList.add("on"); if (i === words.length - 1) { caret.remove(); done?.(); } }, i * perWord));
}

// REWRITE: strike the old sentence, fade it, then write the new one in its place
export function rewrite(sent, html, done) {
  toggle(sent, "strike");
  setTimeout(() => toggle(sent, "out"), 700);
  setTimeout(() => { toggle(sent, "strike", false); toggle(sent, "out", false); write(sent, html, 45, done); }, 1000);
}

export function addChip(list, icon, name, meta) {
  const el = document.createElement("div"); el.className = "chip";
  el.innerHTML = `<i class="ph-duotone ${icon}"></i><span>${name}<small>${meta}</small></span>`;
  list.append(el); nextFrame(() => toggle(el, "in"));
  return el;
}
export function addEntry(list, icon, color, text, meta) {
  const el = document.createElement("div"); el.className = "entry";
  el.innerHTML = `<i class="ph-duotone ${icon}" style="color:${color}"></i><span>${text}<small>${meta}</small></span><span class="undo">Undo</span>`;
  list.querySelector(".title").after(el); nextFrame(() => toggle(el, "in"));
}
export function badge(text, ask = false) { const b = $("badge"); b.lastChild.textContent = text; toggle(b, "ask-tone", ask); toggle(b, "on"); }

// TILT: the scene leans toward the pointer, at most one update per frame
export function tilt() {
  if (reduce) return;
  const scene = $("scene"), stage = scene.parentElement; let frame = 0, rx = 8, ry = -14;
  stage.closest("section").addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    ry = -14 + ((e.clientX - r.left) / r.width - .5) * 8; rx = 8 - ((e.clientY - r.top) / r.height - .5) * 6;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; scene.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`; });
  });
}
