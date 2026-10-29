// Runs on every scene before its own setup: swaps the real workspace and personal details for synthetic ones.
// Nothing real is written here: the signed-in name, email and workspace are read from the snapshot's own sidebar.
const FAKE = { email: "sam@brightline.example", name: "Sam Ortiz", workspace: "Brightline Co." };
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

function realDetails() {
  const spans = [...document.querySelectorAll("span.truncate")];
  const emailEl = spans.find((s) => /@/.test(s.textContent));
  // the signed-in name sits just above the email; the workspace switcher is the first bold truncated label
  const nameEl = emailEl?.previousElementSibling || emailEl?.parentElement?.querySelector("span.font-medium");
  const workspaceEl = spans.find((s) => s.classList.contains("font-medium") && s !== nameEl);
  return { name: nameEl?.textContent.trim(), workspace: workspaceEl?.textContent.trim() };
}

function scrub(root = document.body) {
  const { name, workspace } = realDetails();
  const swaps = [];
  if (name && name !== FAKE.name) swaps.push([name, FAKE.name]);
  if (workspace && workspace !== FAKE.workspace) {
    // also catch longer names that start with the workspace name ("<Workspace> Solutions Inc.")
    swaps.push([new RegExp(`${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( [A-Z][\\w.]*)*`, "g"), FAKE.workspace]);
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    let s = n.textContent.replace(EMAIL, FAKE.email);
    for (const [a, b] of swaps) s = typeof a === "string" ? s.split(a).join(b) : s.replace(a, b);
    if (s !== n.textContent) n.textContent = s;
  }
  // the avatar letter beside the user's name
  if (name) $$("span.rounded-full").forEach((el) => { if (el.textContent.trim() === name[0]) el.textContent = FAKE.name[0]; });
  // hover-only "Updated …" buttons stay hidden in a still
  $$("button").forEach((b) => { if (/^Updated /.test(b.textContent.trim())) b.textContent = "Updated today"; });
}

// Build an element from HTML
function h(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }

window.addEventListener("load", () => scrub(), { capture: true });
document.addEventListener("DOMContentLoaded", () => scrub());
