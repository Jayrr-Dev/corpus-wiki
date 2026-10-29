// Shared by the wiki-page scenes: rebuilds the real page snapshot as a synthetic "Billing sync" article,
// using the app's own markup (breadcrumb, contents, sections, cited lines, line panel).

// A line: array of parts. "text" | ["link", text] ; cites: [n, ...]
const ARTICLE = {
  crumbs: ["Knowledge", "Engineering", "Billing sync"],
  title: "Billing sync",
  explore: ["Payment providers", "Month-end close"],
  sections: [
    { title: null, lines: [
      { parts: [["link", "Billing sync"], " copies every paid invoice from ", ["link", "Ledgerly"], " into the finance database each night, so revenue reports and the ", ["link", "month-end close"], " always match what customers paid."], cites: [1] },
    ] },
    { title: "How it works", lines: [
      { id: "schedule", parts: ["The sync runs every night at 2:00 AM and retries a failed batch three times before it alerts the team."], cites: [1, 3] },
      { parts: ["Each invoice is matched to its customer record first; unmatched invoices wait in a review queue instead of being dropped."], cites: [2] },
      { parts: [["link", "Dave Morales"], " built the current version during the move from ", ["link", "PayCore"], " in March 2026."], cites: [4] },
    ] },
    { title: "When it breaks", lines: [
      { parts: ["A failed run posts an alert with the batch id. Re-run it from the admin panel; never edit the invoice table by hand."], cites: [1] },
      { parts: ["Most failures come from expired provider tokens, which ", ["link", "Priya Nair"], " can renew from the finance console."], cites: [5] },
    ] },
  ],
};

function lineHTML(line) {
  const body = line.parts.map((p) => (Array.isArray(p) ? `<a class="text-link hover:underline">${p[1]}</a>` : `<span>${p}</span>`)).join(" ");
  const cites = line.cites.map((n) => `<sup class="ml-0.5 text-xs"><a class="text-link hover:underline">[${n}]</a></sup>`).join("");
  return `<p class="group/paragraph text-body leading-7" data-line="${line.id || ""}">${body}${cites}<button class="ml-2 text-xs text-faint opacity-0 transition-opacity group-hover/paragraph:opacity-100">Updated today</button></p>`;
}

// Rebuilds the article in place. Returns handy elements.
function buildArticle() {
  // the Pages tree popover that was open in the snapshot
  const tree = $$("button").find((b) => b.textContent.trim() === "Pages" && /text-xs/.test(b.className));
  if (tree) { let el = tree; while (el.parentElement && el.getBoundingClientRect().width < 300) el = el.parentElement; while (el.parentElement && el.parentElement.getBoundingClientRect().height < 600) el = el.parentElement; el.style.display = "none"; }

  const header = $("main header.mb-6");
  const nav = header.querySelector("nav");
  nav.innerHTML = `<a class="text-link hover:underline">${ARTICLE.crumbs[0]}</a><span class="inline-flex items-center gap-2"><span>/</span><a class="text-link hover:underline">${ARTICLE.crumbs[1]}</a></span><span>/</span><span>${ARTICLE.crumbs[2]}</span>`;
  header.querySelector("h1").textContent = ARTICLE.title;

  const toc = $("main nav ol");
  const tocItem = toc.querySelector("li").outerHTML;
  const tocNames = ["Introduction", ...ARTICLE.sections.slice(1).map((s, i) => `${i + 1}. ${s.title}`), "See also", "References"];
  toc.innerHTML = tocNames.map((n) => tocItem.replace(/>[^<]*<\/a>/, `>${n}</a>`)).join("");

  const article = $("main article");
  const [explore, intro, withHeader] = article.children;
  explore.querySelector("ul").innerHTML = ARTICLE.explore.map((n) => `<li><a class="text-link hover:underline">${n}</a></li>`).join("");
  const headerTpl = withHeader.querySelector("header").outerHTML;
  const introMenu = intro.querySelector(".float-right")?.outerHTML || "";
  article.innerHTML = "";
  article.append(explore);
  ARTICLE.sections.forEach((s) => {
    const sec = h(`<section class="scroll-mt-6"></section>`);
    sec.innerHTML = (s.title ? headerTpl.replace(/(<h2[^>]*>)[^<]*(<\/h2>)/, `$1${s.title}$2`) : introMenu) + `<div class="flow-root space-y-4">${s.lines.map(lineHTML).join("")}</div>`;
    article.append(sec);
  });
  return { article, schedule: $('p[data-line="schedule"]') };
}

// Fills the line panel (aside) for the schedule line
function buildPanel(lineText) {
  const aside = byText("This line", "h2")?.closest("aside");
  if (!aside) return null;
  const sections = aside.querySelectorAll("section");
  sections[0].querySelector("p").textContent = lineText;
  const claim = sections[1].querySelector("article");
  claim.querySelector("p").textContent = "Billing sync is scheduled nightly at 02:00 and retries a failed batch up to 3 times.";
  const ev = [...claim.querySelectorAll("a")];
  const quotes = [["The nightly job starts at 02:00 server time.", "Billing-Sync-Runbook.pdf · p.4"], ["If a batch fails it tries again, three times max.", "dave-handover-walkthrough.mp4 · 03:12"]];
  ev.forEach((a, i) => { if (i >= quotes.length) { a.remove(); return; } a.querySelector("q").textContent = quotes[i][0]; a.querySelector("span.truncate").textContent = quotes[i][1]; });
  const hist = sections[2];
  hist.querySelector("span.text-xs.text-faint").textContent = "AI · Oct 29, 2026, 9:42 AM";
  const last = hist.querySelector("li > span:last-child"); if (last) last.textContent = lineText;
  return aside;
}
