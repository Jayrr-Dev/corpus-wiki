// Shot 22, part 2 (1:38.3–1:41.3): "And if two files disagree, it asks you first."
// Real Exceptions screen. One conflict waits in Needs review; the cursor hovers Approve change.
const BASE = "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-panel font-medium whitespace-nowrap transition-all outline-none select-none";
const OUTLINE = `${BASE} border-border bg-background dark:border-input dark:bg-input/30 h-8 gap-1.5 px-2.5`;
const PRIMARY = `${BASE} bg-primary text-primary-foreground h-8 gap-1.5 px-2.5`;
const INPUT = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-panel outline-none placeholder:text-muted-foreground dark:bg-input/30 min-w-48 flex-1";
let card, approve, pts = {};

window.SCENE = {
  duration: 3.4,
  setup() {
    // tabs: Needs review is active with 1
    const [needs, answered] = ["Needs review", "Answered"].map((n) => $$("button").find((b) => b.textContent.trim().startsWith(n)));
    needs.className = answered.className; needs.querySelector("span").textContent = "1";
    answered.className = answered.className.replace("border-foreground font-medium", "border-transparent text-muted-foreground");
    // the list: one item
    const ul = $("main ul.divide-y");
    const li = ul.querySelector("li");
    ul.innerHTML = ""; ul.append(li);
    const spans = li.querySelectorAll("button > span");
    spans[0].innerHTML = `<span class="font-medium tracking-wide text-faint uppercase">Conflicts</span><span class="flex items-center gap-1.5 text-needs-you"><span class="size-1.5 rounded-full bg-needs-you"></span>Needs review</span>`;
    spans[1].textContent = "Two sources with the same date disagree";
    spans[2].textContent = "The runbook says a failed batch is retried 3 times; the 2 Apr standup notes say 5.";
    spans[3].textContent = "Oct 29, 26 @ 9:44 am";
    byText("1–25 of 83", "div").textContent = "1 of 1";
    byText("1 / 4", "span").textContent = "1 / 1";
    // the detail card
    card = $("main article.overflow-hidden");
    card.querySelector("header div.text-xs").innerHTML = `<span class="font-medium tracking-wide text-faint uppercase">Conflicts</span><span class="flex items-center gap-1.5 text-faint">Raised<time class="font-mono">Oct 29, 26 @ 9:44 am</time></span>`;
    card.querySelector("h3").textContent = "Two sources with the same date disagree";
    card.querySelector("div.space-y-2").innerHTML = `<p>Both are dated 2 Apr 2026, so neither one wins on its own. Nothing on the page changes until you decide.</p>`;
    const [why, action, excerpt] = card.querySelectorAll("section");
    why.querySelector("p").textContent = "Billing sync retries a failed batch 3 times (Billing-Sync-Runbook.pdf, p.4).";
    action.querySelector("p").textContent = "Change it to 5 retries, as the standup notes say, and update the Billing sync page.";
    excerpt.querySelector("blockquote").textContent = "Raised billing sync retries to 5 after the PayCore outage. — standup-notes-2026-04-02.md";
    card.querySelector("footer").outerHTML = `<div class="flex flex-col gap-2 border-t px-4 py-3"><div class="flex flex-wrap items-center gap-2">
      <input class="${INPUT}" placeholder="Add a note (optional)"><button class="${OUTLINE}">Reject</button><button class="${PRIMARY}" data-approve>Approve change</button></div></div>`;
    approve = $("[data-approve]");
    const r = approve.getBoundingClientRect(); pts.approve = [r.left + r.width / 2, r.top + r.height / 2 + 4];
  },
  frame(t) {
    camera(t, 3.4, 1.0, 1.02, "40%", "40%");
    const p = easeOut(seg(t, 0.05, 0.5));
    card.style.opacity = p; card.style.transform = `translateY(${(1 - p) * 12}px)`;
    press(approve, t, 2.3, 3.4);
    cursor(t, [[0, 1350, 950], [1.0, 1300, 780], [2.3, pts.approve[0], pts.approve[1]], [3.4, pts.approve[0] + 2, pts.approve[1] + 1]], []);
  },
};
