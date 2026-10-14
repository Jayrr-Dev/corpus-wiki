// =====================================================================
// TUTORIAL STEPS: the first-run path through the prototype, in order.
// Data only, so the card renders whatever is listed here.
// =====================================================================

export type TutorialStep = { title: string; body: string; href: string; linkLabel: string };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    title: "Create a page",
    body: "On Pages, add a page for what you want documented, for example Project Alpha.",
    href: "/",
    linkLabel: "Open Pages",
  },
  {
    title: "Upload a file",
    body: "Drop a PDF, Word or Markdown file on Upload. The AI reads it and drafts what it changes.",
    href: "/upload",
    linkLabel: "Open Upload",
  },
  {
    title: "Watch the page fill in",
    body: "Open your page. Lines appear as the upload is applied. Click a line to see the claims and sources behind it.",
    href: "/",
    linkLabel: "Open Pages",
  },
];
