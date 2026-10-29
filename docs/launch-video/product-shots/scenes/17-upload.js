// Shot 17 (1:06.8–1:13.0): "You just feed it PDFs, Word docs, notes, screenshots, even videos, or connect your Gmail."
// Real Upload screen. Files are dragged onto the drop zone, rows appear and turn Applied, then Gmail threads land.
const FILES = [
  ["Billing-Sync-Runbook.pdf", "PDF", "#bb3f3f"],
  ["Payment-Provider-Decision.docx", "DOCX", "#4d6ab6"],
  ["standup-notes-2026-03-14.md", "MD", "#8a8a8a"],
  ["billing-architecture.png", "PNG", "#369e94"],
  ["brent-handover-walkthrough.mp4", "MP4", "#8278cb"],
];
const MAILS = ["Re: PayCore fees from April", "Fwd: Ledgerly contract signed", "Billing sync failed (batch 4471)"];
let rows, drop, cards, countEl, rowsLabel;

window.SCENE = {
  duration: 6.6,
  setup() {
    drop = byText("Drop files here to upload", "p").closest("div[class*='border']") || byText("Drop files here to upload", "p").parentElement.parentElement;
    const tbody = $("tbody");
    const tpl = tbody.querySelector("tr");
    tbody.innerHTML = "";
    const make = (name, who) => {
      const r = tpl.cloneNode(true);
      r.querySelector("a").textContent = name;
      const spans = [...r.querySelectorAll("td")[2].querySelectorAll("span")];
      spans[0].textContent = who;
      spans[spans.length - 1].textContent = "Oct 29, 26 @ 9:41 am";
      return r;
    };
    const fileRows = FILES.map((f) => make(f[0], "Sam Ortiz"));
    const mailRows = MAILS.map((m) => make("✉ " + m, "Gmail"));
    // newest first: the emails arrive last, so they sit on top
    [...mailRows].reverse().forEach((r) => tbody.append(r));
    [...fileRows].reverse().forEach((r) => tbody.append(r));
    rows = [...fileRows, ...mailRows];
    countEl = $$("button").find((b) => b.textContent.trim().startsWith("Internal"))?.querySelector("span");
    rowsLabel = byText("8 rows", "span");
    // the dragged stack, styled with the app's own classes
    cards = FILES.map(([n, k, c]) => {
      const el = h(`<div class="rounded-md border bg-card text-panel shadow-lg" style="position:absolute;z-index:500;width:340px;display:flex;align-items:center;gap:12px;padding:10px 14px">
        <span style="width:30px;height:36px;border-radius:4px;background:${c};color:#fff;font-size:9px;font-weight:700;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px">${k}</span><span class="font-medium">${n}</span></div>`);
      document.body.append(el);
      return el;
    });
  },
  frame(t) {
    camera(t, 6.6, 1.0, 1.045, "8%", "30%");
    // drag the stack from bottom right onto the drop zone, release at 1.3
    const drag = easeInOut(seg(t, 0.15, 1.3));
    cards.forEach((c, i) => {
      const gone = seg(t, 1.3 + i * 0.05, 1.55 + i * 0.05);
      c.style.left = lerp(1450, 905, drag) + i * 7 + "px";
      c.style.top = lerp(930, 175, drag) + i * 9 + "px";
      c.style.opacity = t < 0.1 ? 0 : 1 - gone;
      c.style.transform = `rotate(${lerp(-5, 1.5, drag) + i * 0.8}deg) scale(${1 - gone * 0.25})`;
    });
    const over = t > 0.9 && t < 1.45;
    drop.style.borderColor = over ? "#8fae8d" : "";
    drop.style.background = over ? "rgba(143,174,141,.10)" : "";
    // rows slide in, then each finishes reading
    let shown = 0;
    rows.forEach((r, i) => {
      const isMail = i >= FILES.length;
      const at = isMail ? 4.6 + (i - FILES.length) * 0.22 : 1.45 + i * 0.12;
      const p = easeOut(seg(t, at, at + 0.35));
      r.style.display = p > 0 ? "" : "none";
      r.style.opacity = p; r.style.transform = `translateY(${(1 - p) * -10}px)`;
      if (p > 0) shown++;
      const done = t > at + (isMail ? 0.9 : 1.1 + i * 0.35);
      const [dot, label] = r.querySelectorAll("td")[1].querySelectorAll("span > span");
      label.textContent = done ? "Applied" : "Reading…";
      dot.className = "size-1.5 shrink-0 rounded-full " + (done ? "bg-applied" : "bg-needs-you");
    });
    if (countEl) countEl.textContent = shown;
    if (rowsLabel) rowsLabel.textContent = `${shown} rows`;
    cursor(t, [[0, 1500, 960], [0.15, 1480, 950], [1.3, 925, 190], [2.2, 1100, 520], [4.2, 1250, 700], [6.6, 1270, 720]], [1.3]);
  },
};
