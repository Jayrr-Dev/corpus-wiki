import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LiveSection } from "./LiveSection";
import type { Tables } from "@/lib/database/types";
import type { ShownIllustration } from "@/lib/composer/types";

vi.stubGlobal("React", React);
vi.mock("@/components/actions/useServerAction", () => ({ useServerAction: () => ({ isPending: false, error: null }) }));
vi.mock("@/lib/realtime/useSectionBuild", () => ({ useSectionBuild: () => ({ step: "Rewriting…", thinking: "", draft: null }) }));
vi.mock("./LinePanel", () => ({ EDIT_REFRESHES: [] }));
vi.mock("./SectionPanel", () => ({ sectionUpdatedAt: () => null }));
vi.mock("./ComposerFigure", () => ({ ComposerFigure: ({ figure }: { figure: ShownIllustration }) => React.createElement("figure", { "data-image": figure.id }, figure.caption) }));
vi.mock("./TextEditor", () => ({ TextEditor: () => null }));
vi.mock("./LineBlock", () => ({ LineBlock: () => null }));
vi.mock("@/lib/server-actions/knowledge", () => ({ submitLineEdit: vi.fn() }));

it.each(["building", "current", "stale"] as const)("renders attached images with no paragraphs while a section is %s", (status) => {
  const figure: ShownIllustration = { id: "original-image", pageId: "page", sectionId: "section", after: "retired-paragraph", caption: "Original illustration", alt: "Drawing", learningGoal: "Clearances", src: "/original-image", evidence: [] };
  const html = renderToStaticMarkup(React.createElement(LiveSection, {
    section: { id: "section", title: "Clearances", status } as Tables<"sections">,
    lines: [], selectedLineId: null, onSelect: vi.fn(), composerFigures: [figure],
  }));
  expect(html).toContain('data-image="original-image"');
  expect(html).toContain("Original illustration");
});
