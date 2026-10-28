// WRITE WORDS: fills an element with text one word at a time, with a blinking
// caret while it grows, the way the wiki's own pages write a new line. Inline
// tags in the html (a citation chip, a code name) appear whole, as one word.
// Returns a cancel function; call it when the demo resets or unmounts.
export function writeWords(el: HTMLElement, html: string, { perWord = 40, onDone }: { perWord?: number; onDone?: () => void } = {}) {
  const template = document.createElement("template");
  template.innerHTML = html;
  el.replaceChildren();
  const words: HTMLElement[] = [];
  template.content.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const part of (node.textContent ?? "").split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { el.append(part); continue; }
        const span = document.createElement("span");
        span.textContent = part;
        el.append(span);
        words.push(span);
      }
    } else if (node instanceof HTMLElement) {
      const copy = node.cloneNode(true) as HTMLElement;
      el.append(copy);
      words.push(copy);
    }
  });
  for (const word of words) word.style.opacity = "0";
  const caret = document.createElement("span");
  caret.setAttribute("aria-hidden", "true");
  caret.className = "ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-landing-glow align-[-0.15em]";
  el.append(caret);

  const timers = words.map((word, i) =>
    setTimeout(() => {
      word.style.transition = "opacity 250ms var(--ease-landing)";
      word.style.opacity = "1";
      if (i === words.length - 1) { caret.remove(); onDone?.(); }
    }, i * perWord),
  );
  if (!words.length) { caret.remove(); onDone?.(); }
  return () => { timers.forEach(clearTimeout); caret.remove(); };
}
