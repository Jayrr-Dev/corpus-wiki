"use client";
import { ComposerFigure } from "./ComposerFigure";

import Link from "next/link";
import { LoaderCircle, X } from "lucide-react";
import { useServerAction } from "@/components/actions/useServerAction";
import { Fragment, type ReactNode, useMemo } from "react";
import { diffPhrases } from "@/components/diff/diffWords";
import { Tooltip } from "@/components/standard/tooltip";
import type { Tables } from "@/lib/database/types";
import type { ShownLine } from "@/lib/queries";
import { formatReferencePages, linkArticleText, type ArticleEvidence, type ArticleLink } from "@/lib/living-page/articleEvidence";
import { isBlock } from "@/lib/living-page/blocks";
import { type SectionBuild, useSectionBuild } from "@/lib/realtime/useSectionBuild";
import { cn } from "@/lib/utils";
import { submitLineEdit } from "@/lib/server-actions/knowledge";
import type { ActionResult } from "@/lib/server-actions/result";
import { ArticleFigure } from "./ArticleFigure";
import { EDIT_REFRESHES } from "./LinePanel";
import { LineBlock } from "./LineBlock";
import { sectionUpdatedAt } from "./SectionPanel";
import { TextEditor } from "./TextEditor";

const noteDate = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const previewDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

// A route can interrupt a rewrite while its Server Action is still running.
async function cancelSectionBuild(sectionId: string): Promise<ActionResult> {
  const response = await fetch(`/api/sections/${encodeURIComponent(sectionId)}/cancel`, { method: "POST" });
  return response.json();
}

// An older version of one line, shown on the page in place of the current text (nothing is saved)
export type LinePreview = { lineId: string; revisionId: string; content: string; createdAt: string };

type LiveSectionProps = {
  composerFigures?: import("@/lib/composer/types").ShownIllustration[];
  section: Tables<"sections">;
  lines: ShownLine[];
  selectedLineId: string | null;
  onSelect: (line: ShownLine) => void;
  isSectionSelected?: boolean;
  onSelectSection?: () => void;
  menu?: ReactNode;
  evidence?: ArticleEvidence;
  links?: ArticleLink[];
  hideHeading?: boolean;
  preview?: LinePreview | null;
  onExitPreview?: () => void;
  // The line being rewritten in place (opened from the line panel's Edit), and how to finish that
  editingLineId?: string | null;
  onEndEdit?: () => void;
};

// Each stored line is a real paragraph, with source refs and links outside the evidence button.
export function LiveSection({ section, lines, selectedLineId, onSelect, isSectionSelected = false, onSelectSection, menu, evidence, links = [], hideHeading = false, preview = null, onExitPreview, editingLineId = null, onEndEdit, composerFigures = [] }: LiveSectionProps) {
  const isStale = section.status !== "current";
  const cancel = useServerAction(cancelSectionBuild, { progress: false, refreshTables: ["sections"] });
  const updatedAt = sectionUpdatedAt(section, lines);
  // While the section is rewritten: the step the server is on and the paragraphs written so far
  const build = useSectionBuild(section.id, section.status === "building");
  // The server only returns illustrations whose snapshot matches the saved text.
  // A pending update alone does not invalidate them; drafts and previews do.
  const showComposerFigures = !preview && section.status !== "building" && !build.step;
  const hasComposerFigure = showComposerFigures && composerFigures.some((f) => lines.some((l) => l.lineId === f.after));
  const revisedDraft = build.draft?.revised ?? {};
  const addedDraft = build.draft?.added ?? [];
  const caretLineId = addedDraft.length ? null : lines.findLast((line) => line.lineId in revisedDraft)?.lineId;
  // One stored line as it reads on the page (or as its text box, or as the draft replacing it)
  const renderLine = (line: ShownLine) => {
    const references = evidence?.byLine.get(line.lineId) ?? [];
    const linePreview = preview?.lineId === line.lineId ? preview : null;
    // Editing in place: the paragraph becomes its own text box, same type and spacing, so nothing jumps
    if (line.lineId === editingLineId) {
      return (
        <div key={line.lineId} id={`line-${line.lineId}`} className="rounded-sm bg-hover">
          <TextEditor content={line.content} label="Edit paragraph" inline onSave={(text) => submitLineEdit(line.lineId, text)} onDone={() => onEndEdit?.()} refreshTables={[...EDIT_REFRESHES]} />
        </div>
      );
    }
    const drafted = revisedDraft[line.lineId];
    if (drafted !== undefined) return <DraftParagraph key={line.lineId} text={drafted} caret={line.lineId === caretLineId} />;
    // Citations, preview note and details button, after the paragraph's last words
    const trailing = (
      <>
        {references.map((reference) => {
          return <sup key={reference.number} className="ml-0.5 text-xs"><Tooltip content={`${reference.title}${reference.citedPages.length ? `, pages ${formatReferencePages(reference.citedPages)}` : ""}`}><a id={reference.anchorId} href={`#reference-${reference.number}`} aria-label={`Source ${reference.number}: ${reference.title}`} className="text-link hover:underline">[{reference.number}]</a></Tooltip></sup>;
        })}
        {!references.length && evidence ? <span className="ml-1 text-xs text-faint">[source needed]</span> : null}
        {linePreview ? (
          <span className="ml-2 text-xs text-stale">
            Preview of {previewDate.format(new Date(linePreview.createdAt))}
            {onExitPreview ? <button type="button" onClick={onExitPreview} className="ml-1.5 text-link hover:underline">Back to current</button> : null}
          </span>
        ) : null}
        <button type="button" onClick={() => onSelect(line)} aria-label="View evidence and edit this paragraph" className="ml-2 text-xs text-faint opacity-0 transition-opacity group-hover/paragraph:opacity-100 focus-visible:opacity-100 hover:text-link">{line.lastChangedAt ? `Updated ${noteDate.format(new Date(line.lastChangedAt))}` : "details"}</button>
      </>
    );
    const lineClass = cn("group/paragraph text-body leading-7", line.lineId === selectedLineId && "rounded-sm bg-hover", line.isStale && "text-faint");
    // A list, table or chart is drawn from its parts (an older version previews as its text)
    if (!linePreview && isBlock(line.content)) {
      return <div key={line.lineId} id={`line-${line.lineId}`} className={lineClass}><LineBlock content={line.content} links={links} trailing={trailing} /></div>;
    }
    return (
      <p key={line.lineId} id={`line-${line.lineId}`} className={cn(lineClass, linePreview && "whitespace-pre-line")}>
        {linePreview ? (
          <PreviewText before={linePreview.content} now={line.content} />
        ) : linkArticleText(line.content, links).map((chunk, index) => chunk.href ? (
          <Link key={index} href={chunk.href} className="text-link hover:underline">{chunk.text}</Link>
        ) : <span key={index}>{chunk.text}</span>)}
        {trailing}
      </p>
    );
  };
  return (
    <section id={`section-${section.id}`} aria-label={section.title} aria-busy={section.status === "building"} className={cn("scroll-mt-6", isStale && "relative pl-3")}>
      {isStale ? (
        <div className="group/gold absolute inset-y-0 left-0 w-3">
          <span aria-hidden="true" className="sb-stale-line" />
          <Tooltip content={cancel.isPending ? "Cancelling update…" : "Cancel section update"}>
            <button type="button" aria-label={`Cancel update for ${section.title}`} disabled={cancel.isPending}
              onClick={() => void cancel.run(section.id)}
              className="absolute top-0 -left-3 z-10 flex size-6 items-center justify-center rounded-full border border-stale bg-background text-stale opacity-0 transition-opacity group-hover/gold:opacity-100 group-focus-within/gold:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait [@media(hover:none)]:opacity-100">
              {cancel.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <X aria-hidden="true" className="size-3.5" />}
            </button>
          </Tooltip>
        </div>
      ) : null}
      {cancel.error ? <p role="alert" className="mb-2 text-panel text-destructive">{cancel.error}</p> : null}
      {!hideHeading ? (
        <header className="group mb-4 flex items-end justify-between gap-2 border-b pb-2">
          <div className="min-w-0">
            {onSelectSection ? (
              <button type="button" onClick={onSelectSection} aria-label="View history and actions for this section" className="block text-xs text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-link">
                {updatedAt ? `Updated ${noteDate.format(new Date(updatedAt))}` : "details"}
              </button>
            ) : null}
            <h2 className={cn("-mx-1 rounded-sm px-1 font-serif text-2xl", isSectionSelected && "bg-hover")}>{section.title}</h2>
          </div>
          {menu}
        </header>
      ) : null}
      {isStale && (build.step || build.thinking) ? <BuildStatus build={build} /> : null}
      {section.status === "stale" && lines.length > 0 ? <p role="status" className="mb-2 text-xs text-muted-foreground">{section.build_cancelled ? "Updates are paused for this section. Use Update to resume." : "This section is awaiting an update."}</p> : null}
      {lines.length === 0 && addedDraft.length === 0 ? (
        build.step ? null : <p className="text-body text-faint">{section.status === "building" ? "Writing this section…" : isStale ? "Waiting to be rewritten." : "Nothing known yet."}</p>
      ) : (
        <div className="flow-root space-y-4">
          {lines.map((line) => (
            <Fragment key={line.lineId}>
              {(hasComposerFigure ? [] : evidence?.figuresByLine.get(line.lineId) ?? []).map((figure) => <ArticleFigure key={figure.key} figure={figure} />)}
              {showComposerFigures ? composerFigures.filter((f) => f.after === line.lineId).map((figure) => <ComposerFigure key={figure.id} figure={figure} />) : null}
              {renderLine(line)}
            </Fragment>
          ))}
          {addedDraft.map((text, index) => <DraftParagraph key={`draft-${index}`} text={text} caret={index === addedDraft.length - 1} />)}
        </div>
      )}
    </section>
  );
}

// BUILD STATUS: what the server is doing now, and the tail of the model's visible thinking
function BuildStatus({ build }: { build: SectionBuild }) {
  return (
    <div aria-live="polite" className="mb-3 space-y-1 text-xs text-faint">
      {build.step ? (
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-stale" />
          {build.step}
        </p>
      ) : null}
      {build.thinking ? <p className="line-clamp-2 pl-3.5 italic">{build.thinking}</p> : null}
    </div>
  );
}

// A paragraph the model is still writing: faded, not yet saved, with a caret where the text is growing
function DraftParagraph({ text, caret }: { text: string; caret: boolean }) {
  return (
    <p className="whitespace-pre-line text-body leading-7 text-faint" title="Being written, not saved yet">
      {text}
      {caret ? <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-0.5 animate-pulse bg-current" /> : null}
    </p>
  );
}

// PREVIEW TEXT: the older version as it read, with each phrase that differs from today dotted;
// hovering one shows what it says now in a tooltip
function PreviewText({ before, now }: { before: string; now: string }) {
  const pieces = useMemo(() => {
    const result: { text: string; now: string | null }[] = [];
    for (const part of diffPhrases(before, now)) {
      const last = result[result.length - 1];
      if (part.kind === "same") result.push({ text: part.text, now: null });
      else if (last && last.now !== null) {
        if (part.kind === "removed") last.text += part.text;
        else last.now += part.text;
      } else result.push({ text: part.kind === "removed" ? part.text : "", now: part.kind === "added" ? part.text : "" });
    }
    return result;
  }, [before, now]);
  return pieces.map((piece, index) => {
    if (piece.now === null) return <span key={index}>{piece.text}</span>;
    const nowText = piece.now.trim();
    // Text the current version added has nothing to show here, so it is a dotted gap
    if (!piece.text.trim()) {
      return (
        <Tooltip key={index} content={`Now adds: “${nowText}”`}>
          <span className="cursor-help text-stale">{piece.text}……</span>
        </Tooltip>
      );
    }
    return (
      <Tooltip key={index} content={nowText ? `Now: “${nowText}”` : "Removed in the current version"}>
        <span className="cursor-help underline decoration-stale decoration-dotted decoration-2 underline-offset-4">{piece.text}</span>
      </Tooltip>
    );
  });
}
