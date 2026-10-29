// Shot 21 (1:26.7–1:34.0): "Ask it anything, like, 'Why did we switch payment providers?' And it answers from what your team actually wrote, with sources."
// Real Ask screen. The question is typed into the composer, sent, and the answer streams in with numbered source chips
// and the Sources list, using the markup from app/(app)/chatbot/Chatbot.tsx.
const Q = "Why did we switch payment providers?";
const CITE = (n) => `<a class="mx-0.5 inline-flex size-5 items-center justify-center rounded bg-hover align-super text-xs font-medium leading-none text-muted-foreground">${n}</a>`;
const ANSWER = [
  ["In March 2026 the team moved billing from ", "PayCore", " to ", "Ledgerly", ". Two things drove it:"],
];
const PARAS = [
  `In March 2026 the team moved billing from PayCore to Ledgerly. Two things drove it.`,
  `PayCore raised its fees by 40% from April${CITE(1)}${CITE(2)}, and its webhooks kept failing during month-end, which broke billing sync three times in one quarter${CITE(3)}.`,
  `Brent Morales led the migration and finished it on 28 March. Priya Nair signed off for finance${CITE(1)}.`,
];
const SOURCES = [["Payment-Provider-Decision.docx", "source"], ["Re: PayCore fees from April", "email"], ["standup-notes-2026-03-14.md", "source"]];
let ta, send, wrapOuter, scroller, empty, log, userMsg, botMsg, botBody, sources, status, tokens = [];

window.SCENE = {
  duration: 7.6,
  setup() {
    ta = $('textarea[aria-label="Message Ask"]');
    send = $('button[aria-label="Send message"]');
    empty = $("div.mx-auto.max-w-3xl.pb-6");
    scroller = empty.parentElement; wrapOuter = scroller.parentElement;
    // the conversation, built exactly like Chatbot.tsx renders it
    log = h(`<div class="mx-auto max-w-3xl space-y-8 py-8" role="log">
      <article class="ml-auto w-fit max-w-[85%] rounded-2xl bg-sidebar px-5 py-3"><p class="mb-2 text-xs font-medium text-muted-foreground">You</p><div class="text-body leading-7 break-words">${Q}</div></article>
      <article class="pr-2"><p class="mb-2 text-xs font-medium text-muted-foreground">Corpus Wiki</p><div class="text-body leading-7 break-words" data-body></div>
        <p role="status" class="text-sm text-muted-foreground" data-status>Searching your knowledge…</p>
        <details open class="mt-5 rounded-xl border bg-sidebar/40 px-4 py-3" data-sources><summary class="cursor-pointer text-xs font-medium text-muted-foreground">Sources · 3</summary><div class="mt-3 grid gap-1">
        ${SOURCES.map(([t, k], i) => `<a class="flex gap-3 rounded-md px-2 py-2 text-sm"><span class="text-muted-foreground">${i + 1}.</span><span>${t}<span class="ml-2 text-xs text-muted-foreground">${k}</span></span></a>`).join("")}</div></details></article></div>`);
    [userMsg, botMsg] = log.querySelectorAll("article");
    botBody = log.querySelector("[data-body]"); sources = log.querySelector("[data-sources]"); status = log.querySelector("[data-status]");
    // stream by visible characters, keeping the citation chips whole
    tokens = PARAS.map((p) => p.split(/(<a [^>]*>.*?<\/a>)/).flatMap((x) => (x.startsWith("<a ") ? [x] : [...x])));
    // the history list gets this chat once it is sent
    const hist = byText("Your conversations will appear here.", "p") || byText("Your conversations will appear here.");
    if (hist) hist.dataset.hist = "1";
  },
  frame(t) {
    camera(t, 7.6, 1.0, 1.035, "62%", "45%");
    const sent = t >= 2.35;
    // type the question, then send
    ta.value = sent ? "" : typed(Q, seg(t, 0.7, 2.0));
    ta.placeholder = "Ask your wiki…";
    send.disabled = !ta.value;
    send.style.opacity = sent ? "" : ta.value ? 1 : "";
    press(send, t, 2.1, 2.5, 2.35);
    // switch from the empty state to the conversation
    if (sent && !log.isConnected) { empty.replaceWith(log); wrapOuter.className = "flex w-full flex-col min-h-0 flex-1"; scroller.className = "min-h-0 flex-1 overflow-y-auto px-5"; }
    if (!sent && log.isConnected) { log.replaceWith(empty); wrapOuter.className = "flex w-full flex-col my-auto shrink-0 py-10 sm:py-16"; scroller.className = "px-5"; }
    userMsg.style.opacity = easeOut(seg(t, 2.35, 2.6));
    status.style.display = t >= 2.5 && t < 3.2 ? "" : "none";
    status.style.opacity = 0.4 + 0.6 * Math.abs(Math.sin(t * 4));
    const total = tokens.reduce((n, p) => n + p.length, 0);
    let left = Math.round(total * seg(t, 3.2, 6.1));
    botBody.innerHTML = tokens.map((p) => { const take = Math.min(left, p.length); left -= take; return take ? `<p class="mb-3">${p.slice(0, take).join("")}</p>` : ""; }).join("");
    const sp = easeOut(seg(t, 6.15, 6.5));
    sources.style.display = sp > 0 ? "" : "none"; sources.style.opacity = sp;
    $$("a", sources).forEach((a, i) => (a.style.background = t >= 6.9 && i === 0 ? "var(--color-hover, #2f2f2f)" : ""));
    const hist = $("[data-hist]"); if (hist) hist.textContent = sent ? Q : "Your conversations will appear here.";
    const s = send.getBoundingClientRect();
    cursor(t, [[0, 1500, 900], [0.5, 1000, 628], [2.1, 1564, 690], [2.8, 1500, 800], [6.6, 1150, 900], [7.6, 1160, 905]], [0.5, 2.35]);
  },
};
