// =====================================================================
// TUTORIAL STEPS: the first-run path, as data. Each step names the real
// element it points at (a data-tour attribute) for the current screen,
// and the action that completes it (reported by that screen).
// =====================================================================

// ACTIONS SCREENS REPORT (reportTutorialAction) that move the tour on
export type TutorialAction = "page-created" | "file-chosen";

// WHERE A STEP POINTS: the element and what to tell the person about it
export type TutorialTarget = { tourId: string; hint: string };

export type TutorialStep = {
  title: string;
  body: string;
  // The element to point at on this screen (the step's own control, or the nav item that leads there)
  targetFor: (pathname: string) => TutorialTarget;
  completedBy: TutorialAction | null;
};

const isWikiPage = (pathname: string) => pathname.startsWith("/p/");

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    title: "Create a page",
    body: "A page is what you want kept up to date, for example Project Alpha.",
    targetFor: (pathname) =>
      pathname === "/pages"
        ? { tourId: "new-page", hint: "Click New page, give it a title and press Create." }
        : { tourId: "nav-pages", hint: "Open Wiki first." },
    completedBy: "page-created",
  },
  {
    title: "Upload a file",
    body: "The AI reads it and drafts what it changes. PDF, Word and Markdown work.",
    targetFor: (pathname) =>
      pathname === "/upload"
        ? { tourId: "upload-dropzone", hint: "Drop a file here, or click Choose files." }
        : { tourId: "nav-upload", hint: "Open Upload." },
    completedBy: "file-chosen",
  },
  {
    title: "Watch the page fill in",
    body: "Lines appear as the upload is applied. Click a line to see the claims and sources behind it.",
    targetFor: (pathname) =>
      isWikiPage(pathname)
        ? { tourId: "page-body", hint: "This is your page. It updates by itself." }
        : { tourId: "nav-pages", hint: "Open Wiki, then your page." },
    completedBy: null,
  },
];
