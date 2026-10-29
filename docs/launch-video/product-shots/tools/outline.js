(() => { const root = document.querySelector(window.__SEL || "h1").closest(window.__UP || "main"); const out = [];
  const walk = (el, d) => { if (d > (window.__DEPTH || 9)) return; const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(" ").slice(0, 40);
    out.push("  ".repeat(d) + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? " ." + el.className.split(" ").slice(0, 6).join(".") : "") + (txt ? "  «" + txt + "»" : "") + (el.children.length > 12 ? "  [" + el.children.length + " children]" : ""));
    [...el.children].slice(0, 12).forEach(c => walk(c, d + 1)); };
  walk(root, 0); return out.join("\n"); })()
