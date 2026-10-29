// Nemotron section, 0:33.3–0:36.2: "Each step gets the cheapest model that does its job well…"
// Real Settings → AI costs. Only the Token Factory models the roles use stay (prices are the app's own),
// calls and spend are synthetic, and the cursor rests on Nano, the cheapest.
const KEEP = {
  "nemotron-3-super-120b-a12b": ["1,204", "$1.96"],
  "Nemotron-3-Ultra-550b-a55b": ["38", "$0.41"],
  "NVIDIA-Nemotron-3-Nano-30B-A3B": ["2,310", "$0.22"],
  "DeepSeek-V4.1-Flash": ["412", "$0.18"],
  "Qwen3-Embedding-8B": ["5,880", "$0.06"],
};
let rows = [], nano;

window.SCENE = {
  duration: 3.0,
  setup() {
    const panel = $("#costs-panel");
    $$("tbody tr", panel).forEach((r) => {
      const name = r.cells[0].textContent.replace("active", "").trim();
      if (!KEEP[name]) { r.remove(); return; }
      r.cells[3].textContent = KEEP[name][0];
      r.cells[4].textContent = KEEP[name][1];
      rows.push(r);
      if (name.startsWith("NVIDIA-Nemotron-3-Nano")) nano = r;
    });
    // footer: row count and page match the filtered table; hide the notes about other providers
    $$("*", panel).forEach((el) => {
      if (el.childElementCount) return;
      const s = el.textContent.trim();
      if (/^\d+ rows$/.test(s)) el.textContent = `${rows.length} rows`;
      if (/^Page 1 of \d+$/.test(s)) el.textContent = "Page 1 of 1";
    });
    $$("p", panel).forEach((el) => { if (/unknown cost|Provider list prices/.test(el.textContent)) el.style.visibility = "hidden"; });
  },
  frame(t) {
    camera(t, 3.0, 1.0, 1.03, "40%", "35%");
    rows.forEach((r, i) => { const p = easeOut(seg(t, 0.05 + i * 0.07, 0.4 + i * 0.07)); r.style.opacity = p; });
    nano.style.background = t >= 1.2 ? "var(--color-hover, #2f2f2f)" : "";
    nano.style.boxShadow = t >= 1.2 ? "inset 3px 0 0 #74a662" : "";
    const r = nano.getBoundingClientRect();
    cursor(t, [[0, 1200, 900], [1.2, r.left + 330, r.top + r.height / 2 + 4], [3.0, r.left + 336, r.top + r.height / 2 + 6]], []);
  },
};
