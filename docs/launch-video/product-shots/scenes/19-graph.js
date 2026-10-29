// Shot 19 (1:19.0–1:24.3): "And it connects everything: the graph, the glossary, who's who, automatically."
// Real Graph screen (filters, legend, counts). The canvas is redrawn as SVG in the app's circle-pack style:
// a ring per group, dashed clusters inside, coloured knowledge dots and thin links. Everything grows in.
const GC = { teal: "#369e94", cyan: "#459ebd", violet: "#8278cb", purple: "#a675bc", pink: "#c66fa5", rose: "#c97683", lime: "#91a64b", copper: "#af805e", coral: "#e88070", amber: "#d9a032", sky: "#72b7e5", mint: "#80c6a1", lavender: "#b09de0", emerald: "#36ab78" };
// [label, cx, cy, r, ring colour, fill alpha, double ring, clusters: [dx, dy, r, colours, label?]]
const GROUPS = [
  ["Ledgerly", 1330, 450, 270, "#8fae8d", 0.04, false, [[-120, -60, 70, ["violet", "purple", "lavender"]], [10, -150, 62, ["teal", "mint", "cyan"]], [80, -20, 66, ["lime", "emerald"], "Billing sync"], [-60, 90, 60, ["teal", "coral", "cyan"]], [120, 120, 78, ["lavender", "violet"]]]],
  ["Brightline Co.", 860, 790, 220, "#c45a5a", 0.16, false, [[-40, -60, 92, ["coral", "rose", "pink", "teal"]], [-95, 60, 55, ["coral", "copper"]], [60, 110, 46, ["sky", "lavender"], "Month-end close"], [100, -10, 40, ["amber", "copper"]]]],
  ["Finance team", 720, 360, 130, "#6887ba", 0.03, true, [[-35, -30, 50, ["emerald", "copper", "lime"]], [45, 30, 44, ["copper", "amber"]], [-20, 70, 34, ["copper", "coral"]]]],
  ["PayCore", 1010, 160, 95, "#b8954a", 0.03, false, [[-30, 0, 38, ["copper", "amber"]], [35, 5, 34, ["lime", "mint"]]]],
];
const rnd = (s) => { const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
let svg, groups = [], clusters = [], dots = [], links = [], countEl, cursorPts = {};

const SPEED = 5.6 / 2.6;
window.SCENE = {
  duration: 2.6,
  setup() {
    const canvas = $("canvas");
    const r = canvas.getBoundingClientRect();
    const ox = r.left, oy = r.top;
    let html = "";
    GROUPS.forEach(([label, cx, cy, gr, ring, alpha, dbl, cls], gi) => {
      html += `<g data-g="${gi}" style="transform-box:fill-box;transform-origin:center">
        <circle cx="${cx}" cy="${cy}" r="${gr}" fill="${ring}" fill-opacity="${alpha}" stroke="${ring}" stroke-opacity=".75" stroke-width="1.5"/>
        ${dbl ? `<circle cx="${cx}" cy="${cy}" r="${gr - 9}" fill="none" stroke="${ring}" stroke-opacity=".55" stroke-width="1.2"/>` : `<circle cx="${cx}" cy="${cy}" r="${gr - 14}" fill="none" stroke="${ring}" stroke-opacity=".25" stroke-width="10"/>`}
        <text x="${cx}" y="${cy - gr - 12}" text-anchor="middle" fill="#dcdcdc" font-family="Inter, sans-serif" font-weight="700" font-size="${gr > 200 ? 26 : 20}">${label}</text></g>`;
      cls.forEach(([dx, dy, cr, cols, clabel], ci) => {
        const x = cx + dx, y = cy + dy, id = `${gi}-${ci}`;
        html += `<g data-c="${id}" style="transform-box:fill-box;transform-origin:center"><circle cx="${x}" cy="${y}" r="${cr}" fill="none" stroke="#8a8a8a" stroke-opacity=".55" stroke-dasharray="3 4"/>${clabel ? `<text x="${x}" y="${y + cr + 16}" text-anchor="middle" fill="#dcdcdc" font-family="Inter, sans-serif" font-weight="600" font-size="13">${clabel}</text>` : ""}</g>`;
        const n = Math.round(cr / 7);
        for (let k = 0; k < n; k++) {
          const s = gi * 100 + ci * 10 + k, a = rnd(s) * Math.PI * 2, d = Math.sqrt(rnd(s + 1)) * (cr - 10);
          const dr = 3 + rnd(s + 2) * (k === 0 ? 9 : 5), col = GC[cols[k % cols.length]];
          const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
          dots.push({ x: px, y: py, g: gi });
          html += `<circle data-d="${dots.length - 1}" cx="${px}" cy="${py}" r="${dr}" fill="${col}" fill-opacity=".9" ${rnd(s + 3) > 0.7 ? `stroke="${col}" stroke-width="2" fill-opacity=".35"` : ""} style="transform-box:fill-box;transform-origin:center"/>`;
        }
      });
    });
    // links between dots inside the big group, and a few across groups
    const pairs = [];
    for (let i = 0; i < 26; i++) { const a = Math.floor(rnd(500 + i) * dots.length), b = Math.floor(rnd(900 + i) * dots.length); if (a !== b && (dots[a].g === dots[b].g || i % 5 === 0)) pairs.push([a, b]); }
    const linkHTML = pairs.map(([a, b]) => { const len = Math.hypot(dots[a].x - dots[b].x, dots[a].y - dots[b].y); return `<line x1="${dots[a].x}" y1="${dots[a].y}" x2="${dots[b].x}" y2="${dots[b].y}" stroke="#cfcfcf" stroke-opacity=".35" stroke-width="1" stroke-dasharray="${len}" data-len="${len}"/>`; }).join("");
    svg = h(`<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="${ox} ${oy} ${r.width} ${r.height}" style="position:absolute;left:${canvas.offsetLeft}px;top:${canvas.offsetTop}px">${linkHTML}${html}</svg>`);
    canvas.replaceWith(svg);
    groups = $$("g[data-g]", svg); clusters = $$("g[data-c]", svg); links = $$("line", svg);
    // legend and counts: synthetic
    const names = [["Billing", 14], ["Finance", 9], ["Payment providers", 6], ["People", 11], ["Vendors", 4]];
    const legend = $$("span.min-w-0.flex-1.truncate.text-xs");
    legend.forEach((el, i) => { const row = el.parentElement; if (i < names.length) { el.textContent = names[i][0]; row.querySelector("span.tabular-nums").textContent = names[i][1]; } else row.style.display = "none"; });
    countEl = $$("p").find((p) => /nodes ·/.test(p.textContent));
    const spinner = $("main [class*='animate-']"); if (spinner) spinner.style.display = "none";
    cursorPts.hover = [1330 + 80, 450 - 20];
  },
  frame(t) {
    camera(t, 2.6, 1.0, 1.04, "5%", "50%");
    t *= SPEED;
    groups.forEach((g, i) => { const p = seg(t, 0.05 + i * 0.18, 0.75 + i * 0.18); const s = p < 1 ? easeOut(p) * (1 + 0.06 * Math.sin(p * Math.PI)) : 1; g.style.transform = `scale(${s})`; g.style.opacity = p > 0 ? 1 : 0; });
    clusters.forEach((c, i) => { const p = easeOut(seg(t, 0.5 + i * 0.06, 1.0 + i * 0.06)); c.style.transform = `scale(${p})`; c.style.opacity = p; });
    $$("circle[data-d]", svg).forEach((d, i) => { const p = seg(t, 0.9 + (i % 60) * 0.018, 1.2 + (i % 60) * 0.018); const s = p < 1 ? easeOut(p) * (1 + 0.4 * Math.sin(p * Math.PI)) : 1; d.style.transform = `scale(${s})`; });
    links.forEach((l, i) => { const p = easeInOut(seg(t, 1.8 + i * 0.04, 2.5 + i * 0.04)); l.style.strokeDashoffset = l.dataset.len * (1 - p); });
    const nodes = Math.round(lerp(0, 197, easeOut(seg(t, 0.1, 2.6)))), edges = Math.round(lerp(0, 445, easeOut(seg(t, 1.6, 3.4))));
    if (countEl) countEl.textContent = `${nodes} nodes · ${edges} links`;
    // hover the Billing sync cluster: its ring brightens
    const hot = clusters.find((c) => c.dataset.c === "0-2");
    hot.querySelector("circle").setAttribute("stroke", t >= 3.2 ? "#dcdcdc" : "#8a8a8a");
    hot.querySelector("circle").setAttribute("stroke-dasharray", t >= 3.2 ? "0" : "3 4");
    cursor(t, [[0, 1500, 1000], [1.5, 1400, 850], [3.2, cursorPts.hover[0], cursorPts.hover[1]], [5.6, cursorPts.hover[0] + 10, cursorPts.hover[1] + 6]], [3.6]);
  },
};
