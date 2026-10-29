// Nemotron section, 0:36.2–0:39.2: "…and I can switch any of them in settings."
// Real Settings → Intelligence, scrolled to "Model by role". The cursor opens one role's model picker;
// the list shows the Token Factory models (the native select is drawn as a list so it can be filmed).
const OPTIONS = ["Default · nemotron-3-super-120b-a12b", "Nemotron-3-Ultra-550b-a55b", "NVIDIA-Nemotron-3-Nano-30B-A3B", "Nemotron-3.5-Super-VL", "DeepSeek-V4.1-Flash", "Qwen3-235B-A22B-Instruct-2507"];
let target, list, items = [], main;

window.SCENE = {
  duration: 3.0,
  setup() {
    main = $("main.overflow-y-auto") || $("main");
    // connector rows (OpenRouter, ElevenLabs) are not part of the Token Factory story: drop them
    ["OpenRouter", "ElevenLabs"].forEach((n) => { const el = byText(n); let row = el; while (row && !/Connected/.test(row.textContent)) row = row.parentElement; if (row) row.style.display = "none"; });
    const sels = $$("#intelligence-panel select").filter((s) => s.options[0]?.textContent.startsWith("Default ·"));
    // scroll so the role rows fill the frame (the model list and connectors above go out of view)
    const first = sels[0].getBoundingClientRect().top;
    main.scrollTop = first - 125;
    target = sels.filter((s) => s.options[0].textContent.includes("nemotron-3-super"))[0];
    const r = target.getBoundingClientRect();
    list = h(`<div class="rounded-lg border bg-popover text-panel shadow-lg" style="position:absolute;left:${r.left}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 380)}px;padding:4px;z-index:80">
      ${OPTIONS.map((o, i) => `<div data-i="${i}" class="rounded-md px-2.5 py-1.5" style="display:flex;justify-content:space-between;gap:10px;white-space:nowrap">${o}${i === 0 ? '<span class="text-muted-foreground">✓</span>' : ""}</div>`).join("")}</div>`);
    document.body.append(list);
    items = $$("[data-i]", list);
  },
  frame(t) {
    camera(t, 3.0, 1.0, 1.03, "55%", "40%");
    const r = target.getBoundingClientRect();
    const open = t >= 0.9;
    list.style.display = open ? "" : "none";
    const p = easeOut(seg(t, 0.9, 1.15));
    list.style.opacity = p; list.style.transform = `translateY(${(1 - p) * -6}px)`;
    target.style.borderColor = t >= 0.6 ? "var(--color-ring, #8a8a8a)" : "";
    items.forEach((el, i) => (el.style.background = t >= 1.7 && i === 1 ? "var(--color-hover, #2f2f2f)" : ""));
    const ultra = items[1].getBoundingClientRect();
    cursor(t, [[0, r.left - 200, r.top + 200], [0.75, r.left + r.width - 60, r.top + r.height / 2 + 4], [1.7, ultra.left + 140, ultra.top + ultra.height / 2 + 4], [3.0, ultra.left + 146, ultra.top + ultra.height / 2 + 6]], [0.9]);
  },
};
