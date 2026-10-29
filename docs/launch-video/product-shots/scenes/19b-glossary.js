// Shot 19, part 2 (1:21.5–1:22.9): "…the glossary…"
// Real Glossary screen. Letter groups and entries are rebuilt with synthetic terms, using the app's badge styles.
const BADGE = { tech: ["Technical term", "bg-emerald-950 text-emerald-100"], general: ["General term", "bg-muted text-muted-foreground"], jargon: ["Jargon", "bg-amber-950 text-amber-100"], acronym: ["Acronym", "bg-blue-950 text-blue-100"] };
const TERMS = [
  ["B", [["Batch", "tech", "A group of paid invoices that billing sync copies in one run. A failed batch is retried before anyone is alerted.", 1, "Sync batch"],
         ["Billing sync", "general", "The nightly job that copies paid invoices from Ledgerly into the finance database.", 1, null]]],
  ["M", [["Month-end close", "jargon", "The last days of each month, when finance checks every invoice and locks the books.", 3, "Close · Books close"]]],
  ["P", [["PSP", "acronym", "Payment service provider: the company that takes card payments for you, such as Ledgerly.", 2, "Payment provider"]]],
  ["R", [["Reconciliation", "tech", "Matching each paid invoice in Ledgerly to its row in the finance database, so nothing is billed twice.", 2, "Recon"]]],
];
let entries = [], hot;

function entryHTML([name, kind, def, ref, also]) {
  const [label, cls] = BADGE[kind];
  return `<div class="py-8 first:pt-0 last:pb-0"><dt class="flex scroll-mt-20 flex-wrap items-baseline gap-x-3 gap-y-1"><span class="text-lg font-semibold tracking-tight text-foreground">${name}</span><span class="rounded px-2 py-0.5 text-xs font-medium ${cls}">${label}</span></dt>
    <dd class="mt-6"><div class="flex items-start justify-between gap-3"><p class="-mx-2 max-w-2xl cursor-pointer rounded-md px-2 text-sm leading-7 transition-colors hover:bg-hover" data-def="${name}">${def}<sup class="ml-1 text-xs leading-none"><a class="text-muted-foreground hover:text-link hover:underline">[${ref}]</a></sup></p></div>${also ? `<p class="mt-2 text-xs text-muted-foreground">Also: ${also}</p>` : ""}</dd></div>`;
}

window.SCENE = {
  duration: 1.6,
  setup() {
    const first = $('section[aria-label^="Letter"]');
    const old = $$('section[aria-label^="Letter"]');
    TERMS.forEach(([letter, list]) => {
      const sec = first.cloneNode(true);
      sec.setAttribute("aria-label", `Letter ${letter}`);
      sec.querySelector("h3").textContent = letter;
      sec.querySelector("dl").innerHTML = list.map(entryHTML).join("");
      first.before(sec);
    });
    old.forEach((s) => s.remove());
    // the References list: synthetic sources only
    const refs = $$("h2, h3").find((h) => h.textContent.trim() === "References");
    const ol = refs && (refs.nextElementSibling?.matches("ol, ul") ? refs.nextElementSibling : refs.parentElement.querySelector("ol, ul"));
    if (ol) {
      const tpl = ol.querySelector("li");
      const names = ["Billing-Sync-Runbook.pdf", "Payment-Provider-Decision.docx", "standup-notes-2026-03-14.md"];
      ol.innerHTML = "";
      names.forEach((n) => { const li = tpl.cloneNode(true); const leaf = [...li.querySelectorAll("*")].reverse().find((e) => e.childElementCount === 0 && e.textContent.trim().length > 3) || li; leaf.textContent = n; ol.append(li); });
    }
    const count = $$("*").find((e) => e.childElementCount === 0 && /^\d+ definitions$/.test(e.textContent.trim()));
    if (count) count.textContent = "24 definitions";
    entries = $$("dl > div");
    hot = $('[data-def="Billing sync"]');
  },
  frame(t) {
    camera(t, 1.6, 1.0, 1.02, "30%", "30%");
    entries.forEach((e, i) => { const p = easeOut(seg(t, i * 0.08, 0.35 + i * 0.08)); e.style.opacity = p; e.style.transform = `translateY(${(1 - p) * 10}px)`; });
    hot.classList.toggle("bg-hover", t >= 0.8);
    const r = hot.getBoundingClientRect();
    cursor(t, [[0, 1150, 700], [0.8, r.left + 260, r.top + 16], [1.6, r.left + 268, r.top + 18]], []);
  },
};
