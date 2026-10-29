// Shot 18 (1:13.5–1:18.7): "It pulls out the facts and writes the wiki for you, every line linked to where it came from."
// Real wiki page. Sections write in, the cursor opens one line's details and the evidence panel slides in.
let A, aside, asideW, paras, btn, pts = {};

window.SCENE = {
  duration: 5.6,
  setup() {
    A = buildArticle();
    aside = buildPanel(A.schedule.innerText.replace(/\[\d\]/g, "").replace("Updated today", "").trim());
    asideW = aside.getBoundingClientRect().width;
    paras = $$("main article section");
    btn = A.schedule.querySelector("button");
    // where things are with the panel closed
    aside.style.width = "0px";
    const r = A.schedule.getBoundingClientRect(), b = btn.getBoundingClientRect();
    pts.line = [r.left + 220, r.top + 14]; pts.btn = [b.left + 30, b.top + 8];
    aside.style.width = asideW + "px";
    const ev = aside.querySelector("article a").getBoundingClientRect();
    pts.ev = [ev.left + 120, ev.top + 30];
  },
  frame(t) {
    camera(t, 5.6, 1.0, 1.0);
    // sections write in one after another
    paras.forEach((s, i) => {
      const p = easeOut(seg(t, 0.1 + i * 0.35, 0.6 + i * 0.35));
      s.style.opacity = p; s.style.transform = `translateY(${(1 - p) * 12}px)`;
      s.style.clipPath = i ? `inset(0 0 ${(1 - p) * 100}% 0)` : "";
    });
    // hover the schedule line (shows its "Updated" button), click it at 2.55
    const hovering = t >= 2.0;
    btn.style.opacity = hovering ? 1 : 0;
    btn.style.color = t >= 2.35 && t < 2.7 ? "var(--color-link, #6b8fd6)" : "";
    A.schedule.classList.toggle("rounded-sm", t >= 2.55);
    A.schedule.classList.toggle("bg-hover", t >= 2.55);
    // the panel slides open
    const open = easeInOut(seg(t, 2.6, 3.1));
    aside.style.width = asideW * open + "px";
    aside.style.opacity = open;
    // evidence cards appear
    $$("article a", aside).forEach((a, i) => { const q = easeOut(seg(t, 3.1 + i * 0.2, 3.5 + i * 0.2)); a.style.opacity = q; a.style.transform = `translateY(${(1 - q) * 8}px)`; });
    const ev = aside.querySelector("article a");
    ev.style.background = t >= 4.4 ? "var(--color-hover, #2f2f2f)" : "";
    cursor(t, [[0, 1250, 980], [1.2, 1150, 800], [2.0, pts.line[0], pts.line[1]], [2.35, pts.btn[0], pts.btn[1]], [3.2, pts.btn[0] + 40, pts.btn[1] + 30], [4.4, pts.ev[0], pts.ev[1]], [5.6, pts.ev[0] + 6, pts.ev[1] + 4]], [2.55]);
  },
};
