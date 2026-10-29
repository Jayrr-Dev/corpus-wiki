// Shot 22, part 1 (1:34.5–1:38.1): "Drop in a newer file, and it only rewrites the lines that changed."
// Real wiki page. A progress toast reports the new file; only the schedule line flashes, strikes through and is rewritten.
const OLD = "The sync runs every night at 2:00 AM and retries a failed batch three times before it alerts the team.";
const NEW = "The sync runs every hour and retries a failed batch three times before it alerts the team.";
let A, line, textSpan, cites, toast, btn;

window.SCENE = {
  duration: 4.0,
  setup() {
    A = buildArticle();
    const aside = byText("This line", "h2")?.closest("aside");
    if (aside) aside.style.display = "none";
    line = A.schedule;
    textSpan = line.querySelector("span");
    cites = line.querySelectorAll("sup");
    cites[cites.length - 1].insertAdjacentHTML("afterend", `<sup class="ml-0.5 text-xs" data-new><a class="text-link hover:underline">[6]</a></sup>`);
    btn = line.querySelector("button");
    // the app's toast (top right, like ProgressToast)
    toast = h(`<div class="fixed top-4 right-4 z-40 sm:top-6 sm:right-6"><div class="flex w-96 max-w-full flex-col overflow-hidden rounded-xl border bg-background text-panel text-foreground shadow-lg">
      <div class="flex items-center gap-2 px-4 pt-3"><span class="size-1.5 shrink-0 rounded-full bg-applied"></span><span class="font-medium">standup-notes-2026-04-02.md</span></div>
      <p class="px-4 pt-1 pb-3 text-muted-foreground" data-detail>Reading…</p></div></div>`);
    document.body.append(toast);
  },
  frame(t) {
    camera(t, 4.0, 1.0, 1.02, "45%", "38%");
    // toast slides in and reports
    const ti = easeOut(seg(t, 0.1, 0.45)) * (1 - seg(t, 3.4, 3.8));
    toast.style.opacity = ti; toast.style.transform = `translateY(${(1 - Math.min(1, ti * 1.4)) * -16}px)`;
    toast.querySelector("[data-detail]").textContent = t < 0.9 ? "Reading…" : "Applied · 1 line rewritten";
    // every other line stays put; this one goes stale, strikes through, then is rewritten
    const stale = t >= 0.9 && t < 1.6;
    if (t < 0.9) textSpan.innerHTML = OLD;
    else if (t < 1.6) textSpan.innerHTML = `<span style="text-decoration:line-through;opacity:.55">${OLD}</span>`;
    else textSpan.textContent = typed(NEW, seg(t, 1.6, 2.5));
    line.querySelector("[data-new]").style.display = t >= 2.5 ? "" : "none";
    line.style.transition = "none";
    line.classList.add("rounded-sm");
    line.style.background = stale ? "color-mix(in oklab, var(--sb-stale) 22%, transparent)" : t >= 1.6 && t < 3.4 ? "color-mix(in oklab, var(--sb-applied) 18%, transparent)" : "";
    line.style.boxShadow = stale ? "inset 3px 0 0 var(--sb-stale)" : t >= 1.6 && t < 3.4 ? "inset 3px 0 0 var(--sb-applied)" : "";
    btn.style.opacity = t >= 2.5 ? 1 : 0;
    const r = line.getBoundingClientRect();
    cursor(t, [[0, 1500, 900], [1.2, 1300, 700], [2.6, 1180, 560], [4.0, 1190, 570]], []);
  },
};
