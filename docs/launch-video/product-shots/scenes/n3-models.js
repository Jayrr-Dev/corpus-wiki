// Nemotron section, 0:08.5–0:26.4 (≈17.9 s): Super → Ultra → Nano + Vision, lit on the real "AI handoffs" diagram.
// Role → model pairs follow ROLE_DEFAULT_MODELS in lib/ai/config.ts.
const MODELS = {
  super: ["Nemotron 3 Super", "#36ab78"],
  ultra: ["Nemotron 3 Ultra", "#8278cb"],
  nano: ["Nemotron 3 Nano", "#72b7e5"],
  vl: ["Nemotron 3.5 Super VL", "#d9a032"],
};
// node label (+ which occurrence), model, phase start (s)
const LIGHTS = [
  ["Reconciler", 0, "super", 0.6], ["Entity clean-up", 0, "super", 1.4], ["Definer", 0, "super", 2.1], ["Researcher", 0, "super", 2.8],
  ["Domain Decider", 0, "ultra", 6.6], ["Planner", 0, "ultra", 7.3], ["Article reviewer", 0, "ultra", 7.9], ["Domain steward", 0, "ultra", 8.6], ["Curator", 0, "ultra", 9.2], ["Domain Decider", 1, "ultra", 9.6],
  ["Linker", 0, "nano", 12.0],
  ["Media analyst", 0, "vl", 14.2],
];
let marks = [], legend, legendRows = {}, dot, path = [];

function nodeCentre(label, nth) {
  const b = $$("button[class*='__shape']").filter((x) => x.textContent.replace(/\s+/g, " ").trim() === label)[nth];
  const r = b.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2, r.width];
}

window.SCENE = {
  duration: 17.9,
  setup() {
    // only nodes inside the diagram's visible area (not clipped, not under its legend bar)
    const view = $("button[class*='__shape']").closest("[class*='__canvas']") || document.body;
    const vr = view.getBoundingClientRect();
    LIGHTS.forEach(([label, nth, model, at]) => {
      const [x, y, w] = nodeCentre(label, nth), [name, col] = MODELS[model];
      if (x < vr.left + 20 || x > vr.right - 40 || y < vr.top || y > vr.bottom - 120) return;
      const ring = h(`<div style="position:absolute;left:${x - w / 2 - 7}px;top:${y - w / 2 - 7}px;width:${w + 14}px;height:${w + 14}px;border-radius:50%;border:2.5px solid ${col};box-shadow:0 0 22px ${col};pointer-events:none;z-index:60"></div>`);
      const tag = h(`<div class="rounded px-1.5 py-0.5 text-xs font-medium" style="position:absolute;left:${x}px;top:${y + w / 2 + 34}px;transform:translateX(-50%);background:${col}22;color:${col};border:1px solid ${col}66;white-space:nowrap;z-index:61;pointer-events:none">${name.replace("Nemotron ", "")}</div>`);
      document.body.append(ring, tag);
      marks.push({ ring, tag, at, model });
    });
    // legend: a slim row beside the "How your AI roles work together" heading
    const head = byText("How your AI roles work together", "h2") || byText("How your AI roles work together");
    const hr = head.getBoundingClientRect();
    legend = h(`<div class="text-panel" style="position:absolute;left:${hr.right + 40}px;top:${hr.top - 4}px;display:flex;align-items:center;gap:8px;z-index:70">
      <span class="text-xs font-medium tracking-wide text-faint uppercase" style="margin-right:4px">NVIDIA Nemotron on Nebius Token Factory</span>
      ${Object.entries(MODELS).map(([k, [n, c]]) => `<span data-k="${k}" class="rounded-full border px-2.5 py-0.5 text-xs font-medium" style="display:inline-flex;align-items:center;gap:6px;border-color:${c}66;color:${c}"><span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>${n}</span>`).join("")}</div>`);
    document.body.append(legend);
    $$("[data-k]", legend).forEach((r) => (legendRows[r.dataset.k] = r));
    // a pulse that travels from "You upload a file" to the Reconciler
    const [ux, uy] = nodeCentre("You upload a file", 0), [rx, ry] = nodeCentre("Reconciler", 0);
    path = [[ux + 40, uy], [rx, ry]];
    dot = h(`<div style="position:absolute;width:12px;height:12px;border-radius:50%;background:#36ab78;box-shadow:0 0 14px #36ab78;z-index:62;pointer-events:none"></div>`);
    document.body.append(dot);
  },
  frame(t) {
    camera(t, 17.9, 1.0, 1.04, "65%", "35%");
    marks.forEach(({ ring, tag, at, model }) => {
      const p = easeOut(seg(t, at, at + 0.4));
      // the active phase glows; earlier phases stay lit but calmer
      const phaseEnd = { super: 6.4, ultra: 11.8, nano: 14.0, vl: 99 }[model];
      const calm = t > phaseEnd ? 0.45 : 1;
      ring.style.opacity = p * calm; ring.style.transform = `scale(${0.8 + 0.2 * p})`;
      tag.style.opacity = p * calm;
    });
    const L = easeOut(seg(t, 0.2, 0.7));
    legend.style.opacity = L; legend.style.transform = `translateY(${(1 - L) * -6}px)`;
    Object.entries(legendRows).forEach(([k, r]) => {
      const on = { super: [0.6, 6.4], ultra: [6.6, 11.8], nano: [12.0, 14.0], vl: [14.2, 99] }[k];
      r.style.opacity = t >= on[0] && t < on[1] ? 1 : 0.35; r.style.background = t >= on[0] && t < on[1] ? "color-mix(in oklab, currentColor 14%, transparent)" : "";
    });
    const d = easeInOut(seg(t, 0.0, 0.6));
    dot.style.left = lerp(path[0][0], path[1][0], d) - 6 + "px"; dot.style.top = lerp(path[0][1], path[1][1], d) - 6 + "px";
    dot.style.opacity = t < 0.65 ? 1 : 0;
    const R = nodeCentre("Reconciler", 0), C = nodeCentre("Curator", 0), Li = nodeCentre("Linker", 0), M = nodeCentre("Media analyst", 0);
    cursor(t, [[0, 1500, 900], [1.0, R[0] + 20, R[1] + 24], [5.5, R[0] + 26, R[1] + 30], [8.0, C[0] + 20, C[1] + 24], [12.0, Li[0] + 20, Li[1] + 24], [14.4, M[0] + 20, M[1] + 24], [17.9, M[0] + 24, M[1] + 28]], []);
  },
};
