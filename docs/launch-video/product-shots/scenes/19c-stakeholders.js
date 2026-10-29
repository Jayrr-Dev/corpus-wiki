// Shot 19, part 3 (1:22.9–1:24.6): "…who's who, automatically."
// Real Stakeholders screen. Cards are rebuilt with synthetic people and companies, using the app's card markup.
const KIND = { Person: "bg-rose-950 text-rose-100", Company: "bg-lime-950 text-lime-100" };
const PEOPLE = [
  ["Brent Morales", "Person", 720, "Senior engineer who built billing sync and led the move from PayCore to Ledgerly.", "Owns billing sync and its runbook; the person to ask when a batch fails.", [["Team", "Engineering"], ["Left", "Friday, 3 Apr 2026"]], ["Built the current billing sync", "Led the PayCore → Ledgerly migration", "Recorded the handover walkthrough"], "31 claims · 4 sources"],
  ["Priya Nair", "Person", 810, "Finance lead who owns invoicing and signs off on payment providers.", "Approves provider changes and renews expired provider tokens.", [["Team", "Finance"], ["Signs off", "Payment providers"]], ["Signed the Ledgerly contract", "Runs the month-end close"], "22 claims · 3 sources"],
  ["Marco Silva", "Person", 340, "Finance analyst who checks reconciliation reports after each sync.", "Flags invoices that land in the review queue.", [["Team", "Finance"], ["Reports to", "Priya Nair"]], ["Reviews the reconciliation report", "Escalates unmatched invoices"], "9 claims · 2 sources"],
];
const COMPANIES = [
  ["Ledgerly", "Company", 640, "Payment provider used for billing since March 2026.", "Sends paid invoices that billing sync copies each night.", [["Since", "Mar 2026"], ["Contract", "Signed by Priya Nair"]], ["Webhooks feed billing sync"], "18 claims · 3 sources"],
  ["PayCore", "Company", 300, "Former payment provider, replaced after a 40% fee rise.", "No longer used; old invoices stay in the archive.", [["Until", "Mar 2026"]], ["Webhooks failed at month-end"], "11 claims · 2 sources"],
  ["Brightline Co.", "Company", 1000, "The company this wiki is about.", "Every page here describes how Brightline works.", [["Teams", "Engineering, Finance"]], ["Runs billing on Ledgerly"], "64 claims · 12 sources"],
];
let cards = [], hot;

function initials(n) { return n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }
function cardHTML(tpl, [name, kind, power, desc, work, facts, bullets, foot]) {
  const a = tpl.cloneNode(true);
  const av = a.querySelector("header > span"); av.textContent = initials(name); av.className = av.className.replace(/bg-\S+ text-\S+/, KIND[kind]);
  a.querySelector("header a").textContent = name;
  const badges = a.querySelectorAll("header div.mt-1 span");
  badges[0].textContent = kind; badges[0].className = badges[0].className.replace(/bg-\S+ text-\S+/, KIND[kind]);
  badges[1].textContent = `Power ${power}`;
  a.querySelector("span.line-clamp-3").textContent = desc;
  a.querySelector("div.space-y-0\\.5 p.text-xs.text-muted-foreground").textContent = work;
  a.querySelector("dl").innerHTML = facts.map(([k, v]) => `<div class="contents"><dt class="text-faint">${k}</dt><dd class="min-w-0">${v}</dd></div>`).join("");
  a.querySelector("ul").innerHTML = bullets.map((b) => `<li>${b}</li>`).join("");
  a.querySelector("footer span").textContent = foot;
  return a;
}

window.SCENE = {
  duration: 1.8,
  setup() {
    const sections = $$("section.space-y-3");
    const [s1, s2] = sections;
    sections.slice(2).forEach((s) => s.remove());
    const tpl = s1.querySelector("article");
    [[s1, "People", PEOPLE], [s2, "Companies", COMPANIES]].forEach(([sec, title, list]) => {
      sec.querySelector("h2").textContent = `${title} ${list.length}`;
      const ul = sec.querySelector("ul");
      const li = ul.querySelector("li");
      ul.innerHTML = "";
      list.forEach((d) => { const item = li.cloneNode(false); item.append(cardHTML(tpl, d)); ul.append(item); });
    });
    // filter chips: All 6 · People 3 · Companies 3, the rest hidden
    const all = $$("button").find((b) => /^All\s*\d+$/.test(b.textContent.trim()));
    if (all) {
      const chips = [...all.parentElement.children];
      const labels = [["All", 6], ["People", 3], ["Companies", 3]];
      chips.forEach((c, i) => { if (i < labels.length) { c.childNodes[0].textContent = labels[i][0] + " "; const n = c.querySelector("span"); if (n) n.textContent = labels[i][1]; } else c.style.display = "none"; });
    }
    cards = $$("ul li article");
    hot = cards[0];
  },
  frame(t) {
    camera(t, 1.8, 1.0, 1.02, "30%", "30%");
    cards.forEach((c, i) => { const p = easeOut(seg(t, i * 0.07, 0.35 + i * 0.07)); c.style.opacity = p; c.style.transform = `translateY(${(1 - p) * 14}px) scale(${0.98 + p * 0.02})`; });
    hot.style.borderColor = t >= 0.9 ? "color-mix(in oklab, var(--color-link, #6b8fd6) 40%, transparent)" : "";
    const r = hot.getBoundingClientRect();
    cursor(t, [[0, 1300, 900], [0.9, r.left + r.width * 0.6, r.top + 60], [1.8, r.left + r.width * 0.6 + 6, r.top + 64]], []);
  },
};
