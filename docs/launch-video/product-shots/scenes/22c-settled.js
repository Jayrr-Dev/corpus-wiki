// Shot 22, part 3 (1:41.6–1:47.2): "A normal wiki only knows what someone remembered to write down. This one keeps up on its own."
// Real wiki page after the conflict is approved: the schedule line now says every hour and five times, cited [6],
// a toast confirms the decision, and the cursor rests while the camera drifts in.
const DONE = "The sync runs every hour and retries a failed batch five times before it alerts the team.";
let A, line, toast;

window.SCENE = {
  duration: 5.7,
  setup() {
    A = buildArticle();
    const aside = byText("This line", "h2")?.closest("aside");
    if (aside) aside.style.display = "none";
    line = A.schedule;
    line.querySelector("span").textContent = DONE;
    const cites = line.querySelectorAll("sup");
    cites[cites.length - 1].insertAdjacentHTML("afterend", `<sup class="ml-0.5 text-xs"><a class="text-link hover:underline">[6]</a></sup>`);
    line.querySelector("button").style.opacity = 1;
    toast = h(`<div class="fixed top-4 right-4 z-40 sm:top-6 sm:right-6"><div class="flex w-96 max-w-full flex-col overflow-hidden rounded-xl border bg-background text-panel text-foreground shadow-lg">
      <div class="flex items-center gap-2 px-4 pt-3"><span class="size-1.5 shrink-0 rounded-full bg-applied"></span><span class="font-medium">Change approved</span></div>
      <p class="px-4 pt-1 pb-3 text-muted-foreground">Billing sync · 1 line rewritten · Undo in Changes</p></div></div>`);
    document.body.append(toast);
  },
  frame(t) {
    camera(t, 5.7, 1.0, 1.035, "45%", "40%");
    const ti = easeOut(seg(t, 0.1, 0.5)) * (1 - seg(t, 4.6, 5.1));
    toast.style.opacity = ti; toast.style.transform = `translateY(${(1 - Math.min(1, ti * 1.4)) * -16}px)`;
    // the rewritten line glows once, then settles like every other line
    const glow = 1 - seg(t, 1.2, 3.0);
    line.classList.add("rounded-sm");
    line.style.background = glow > 0 ? `color-mix(in oklab, var(--sb-applied) ${Math.round(18 * glow)}%, transparent)` : "";
    line.style.boxShadow = glow > 0 ? `inset 3px 0 0 color-mix(in oklab, var(--sb-applied) ${Math.round(100 * glow)}%, transparent)` : "";
    const r = line.getBoundingClientRect();
    cursor(t, [[0, 1500, 880], [1.4, r.left + 520, r.top + 40], [5.7, r.left + 528, r.top + 46]], []);
  },
};
