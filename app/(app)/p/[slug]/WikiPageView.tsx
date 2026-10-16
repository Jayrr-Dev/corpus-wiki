"use client";

import Link from "next/link";
import { pageAncestors } from "@/lib/living-page/pageHierarchy";
import { articleNavigation } from "@/lib/living-page/articleNavigation";
import { useEffect, useRef, useState } from "react";
import { PageIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBoundary } from "@/components/error";
import { type LinePreview, LinePanel, LiveSection, SectionPanel } from "@/components/living-page";
import { ArticleSources } from "@/components/living-page/ArticleSources";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import { useServerAction } from "@/components/actions/useServerAction";
import type { Tables } from "@/lib/database/types";
import { useEntities, usePages, useSectionLines, useSections, type ShownLine } from "@/lib/queries";
import { useArticleEvidence } from "@/lib/queries/articleEvidence";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { expandRelatedArticles, improveArticle, refreshStaleSections } from "@/lib/server-actions/pages";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { AddSectionForm } from "./AddSectionDialog";
import { SectionMenu } from "./SectionMenu";
import { UpdateArticleDialog } from "./UpdateArticleDialog";
import { Loader } from "@/components/standard/loader";
import { ReviewPageButton } from "./ReviewPageButton";

export function WikiPageView({ slug }: { slug: string }) {
  const { data: pages = [], isPending, error } = usePages({ filters: { slug } });
  const page = pages[0];
  if (isPending) return <Loader className="h-full" />;
  if (error || !page) return <ReadingPane title="Page" width="prose"><EmptyState icon={PageIcon} title={error ? error.message : "No page with this address"} /></ReadingPane>;
  return <WikiPageBody key={page.id} page={page} />;
}

function WikiPageBody({ page }: { page: Tables<"pages"> }) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  // A clicked section title opens its own panel in place of a line's
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  // An older version of the selected line shown on the page from History's Preview (nothing is saved)
  const [preview, setPreview] = useState<LinePreview | null>(null);
  // The line being rewritten in place on the page
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const sectionsQuery = useSections({ filters: { page_id: page.id } });
  const sections = sectionsQuery.data ?? [];
  const linesQuery = useSectionLines(page.id);
  const lines = sections.flatMap((section) => (linesQuery.data ?? []).filter((line) => line.sectionId === section.id));
  const staleRefresh = useAutoRefreshStale(lines, !linesQuery.isPending);
  const evidence = useArticleEvidence(lines);
  const allPages = usePages();
  const ancestors = pageAncestors(allPages.data ?? [], page);
  const children = (allPages.data ?? []).filter((other) => other.parent_page_id === page.id);
  const entities = useEntities();
  const allSections = useSections();
  const { links, related } = articleNavigation(allPages.data ?? [], entities.data ?? [], allSections.data ?? [], page.id, lines.map((line) => line.content).join(" "));
  useRealtimeInvalidation("sections", { filter: `page_id=eq.${page.id}` });
  useRealtimeInvalidation("lines");
  useRealtimeInvalidation("change_notes");
  const selected = lines.find((line) => line.lineId === selectedLineId);
  const shownPreview = preview && preview.lineId === selected?.lineId ? preview : null;
  const selectLine = (line: ShownLine) => {
    setSelectedLineId(line.lineId);
    setSelectedSectionId(null);
    if (line.lineId !== preview?.lineId) setPreview(null);
    if (line.lineId !== editingLineId) setEditingLineId(null);
  };
  // Edit opens the paragraph as a text box where it sits (a preview of an older version closes first)
  const editLine = (line: ShownLine) => {
    selectLine(line);
    setPreview(null);
    setEditingLineId(line.lineId);
  };
  const selectSection = (section: Tables<"sections">) => {
    setSelectedSectionId(section.id);
    setSelectedLineId(null);
    setPreview(null);
    setEditingLineId(null);
  };
  const selectedSection = sections.find((section) => section.id === selectedSectionId);
  const overview = sections.find((section) => section.title.toLowerCase() === "overview");
  // A finished section with no lines is hidden; one still being written keeps its placeholder.
  const isEmpty = (section: Tables<"sections">) => !linesQuery.isPending && section.status === "current" && !lines.some((line) => line.sectionId === section.id);
  const introduction = overview && (showEmpty || !isEmpty(overview)) ? overview : undefined;
  const allTopics = sections.filter((section) => section.id !== overview?.id);
  const emptyCount = allTopics.filter(isEmpty).length + (overview && isEmpty(overview) ? 1 : 0);
  const topics = showEmpty ? allTopics : allTopics.filter((section) => !isEmpty(section));
  const error = sectionsQuery.error?.message ?? linesQuery.error?.message;
  const renderSection = (section: Tables<"sections">, hideHeading = false) => (
    <ErrorBoundary key={section.id} where={`The section "${section.title}"`}>
      <LiveSection section={section} lines={lines.filter((line) => line.sectionId === section.id)} selectedLineId={selectedLineId} onSelect={selectLine} isSectionSelected={section.id === selectedSectionId} onSelectSection={() => selectSection(section)} preview={shownPreview} onExitPreview={() => setPreview(null)} editingLineId={editingLineId} onEndEdit={() => setEditingLineId(null)} evidence={evidence.loading ? undefined : evidence} links={links} hideHeading={hideHeading} menu={<SectionMenu section={section} />} />
    </ErrorBoundary>
  );
  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <header data-tour="module-header" className="mb-6 border-b pb-4">
        <nav aria-label="Page hierarchy" className="mb-3 flex flex-wrap items-center gap-2 text-panel">
          <Link href="/" className="text-link hover:underline">Knowledge</Link>
          {ancestors.map((ancestor) => <span key={ancestor.id} className="inline-flex items-center gap-2"><span aria-hidden="true">/</span><Link href={`/p/${ancestor.slug}`} className="text-link hover:underline">{ancestor.title}</Link></span>)}
          <span aria-hidden="true">/</span><span aria-current="page">{page.title}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 font-serif text-3xl leading-tight">{page.title}</h1>
          <div className="text-panel"><PageActions page={page} /></div>
        </div>
      </header>
      {error ? <p role="alert" className="mb-4 text-panel">Could not load this article: {error}</p> : null}
      {staleRefresh.error ? <p role="alert" className="mb-4 text-panel">{staleRefresh.error}</p> : null}
      {staleRefresh.isPending ? <p className="mb-4 text-panel text-faint">Updating stale lines…</p> : null}
      {sectionsQuery.isPending || linesQuery.isPending ? <Loader label="Loading article…" /> : null}
      {/* A placeholder topic page has no sections: its scope introduces it, and its pages are listed below */}
      {!sectionsQuery.isPending && !sections.length && page.scope ? <p className="mb-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">{page.scope}</p> : null}
      {!sectionsQuery.isPending && !sections.length && !page.scope && !children.length ? <EmptyState icon={PageIcon} title="This page has no sections yet" /> : null}
      <div className="grid min-w-0 gap-8 xl:grid-cols-[10rem_minmax(0,1fr)]">
        {sections.length > 0 ? <nav aria-label="Article contents" className="text-panel xl:sticky xl:top-6 xl:self-start">
          <h2 className="mb-2 font-semibold">Contents</h2>
          <ol className="space-y-2 border-l pl-3">
            {introduction ? <li><a className="text-link hover:underline" href={`#section-${introduction.id}`}>Introduction</a></li> : null}
            {topics.map((section, index) => <li key={section.id}><a className="text-link hover:underline" href={`#section-${section.id}`}>{index + 1}. {section.title}</a></li>)}
            {related.length ? <li><a className="text-link hover:underline" href="#article-see-also">See also</a></li> : null}
            <li><a className="text-link hover:underline" href="#article-sources">References</a></li>
          </ol>
        </nav> : null}
        <article className="min-w-0 space-y-8" data-tour="page-body" aria-label={page.title}>
          {children.length ? <section aria-label="Subpages" className="rounded-md border p-4"><h2 className="mb-2 font-semibold">Explore this topic</h2><ul className="grid gap-2 sm:grid-cols-2">{children.map((child) => <li key={child.id}><Link href={`/p/${child.slug}`} className="text-link hover:underline">{child.title}</Link></li>)}</ul></section> : null}
          {introduction ? renderSection(introduction, true) : null}
          {topics.map((section) => renderSection(section))}
          {emptyCount ? <button type="button" onClick={() => setShowEmpty((shown) => !shown)} className="text-panel text-faint hover:text-link">{showEmpty ? "Hide" : "Show"} {emptyCount} empty {emptyCount === 1 ? "section" : "sections"}</button> : null}
          {related.length ? <section id="article-see-also" className="scroll-mt-6 border-t pt-5">
            <h2 className="mb-3 font-serif text-2xl">See also</h2>
            <ul className="list-disc space-y-1 pl-5 text-body">{related.map((other) => <li key={other.id}><Link href={`/p/${other.slug}`} className="text-link hover:underline">{other.title}</Link></li>)}</ul>
          </section> : null}
          <ArticleSources references={evidence.references} loading={evidence.loading} error={evidence.error} />
        </article>
      </div>
      {selectedSection ? <RightPanelSlot onClose={() => setSelectedSectionId(null)}><SectionPanel key={selectedSection.id} section={selectedSection} lines={lines.filter((line) => line.sectionId === selectedSection.id)} menu={<SectionMenu section={selectedSection} className="" />} onSelectLine={selectLine} /></RightPanelSlot> : null}
      {selected ? <RightPanelSlot onClose={() => { setSelectedLineId(null); setPreview(null); }}><LinePanel key={selected.lineRevisionId} line={selected} preview={shownPreview} onPreview={setPreview} isEditing={editingLineId === selected.lineId} onEdit={() => editLine(selected)} /></RightPanelSlot> : null}
    </div>
  );
}

// Opens an article that still cites an old claim and rewrites those sections once.
// A failed or unchanged line is not sent again until the page is opened again.
function useAutoRefreshStale(lines: ShownLine[], ready: boolean) {
  const refresh = useServerAction(refreshStaleSections, { progress: { title: "Updating stale lines", detail: "Rewriting sections that cite old claims…" } });
  const sent = useRef(new Set<string>());
  const refreshRef = useRef(refresh);
  const staleKey = lines.filter((line) => line.isStale).map((line) => `${line.sectionId}:${line.lineId}`).sort().join("\n");
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    if (!ready) return;
    if (!staleKey) return;
    const pending = staleKey.split("\n").filter((key) => !sent.current.has(key));
    if (!pending.length) return;
    const sectionIds = [...new Set(pending.map((key) => key.slice(0, key.indexOf(":"))))];
    const timer = window.setTimeout(() => {
      for (const key of pending) sent.current.add(key);
      void refreshRef.current.run(sectionIds);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, staleKey]);
  return refresh;
}

function PageActions({ page }: { page: Tables<"pages"> }) {
  const improve = useServerAction(improveArticle, { progress: { title: `Improving “${page.title}”`, detail: "Restructuring the article with AI…" } });
  const expand = useServerAction(expandRelatedArticles, { progress: { title: `Expanding “${page.title}”`, detail: "Writing related articles with AI…" } });
  return (
    <div>
      <div className="flex items-center gap-1">
        <ReviewPageButton pageId={page.id} disabled={improve.isPending || expand.isPending} />
        <UpdateArticleDialog id={page.id} title={page.title} scope="page" disabled={improve.isPending || expand.isPending} />
        <PageMenu page={page} extraItems={[
          ...(page.entity_id ? [{ label: improve.isPending ? "Structuring article…" : "Improve article", disabled: improve.isPending || expand.isPending, onSelect: () => { void improve.run(page.id); } }] : []),
          ...((page.context_entity_id ?? page.entity_id) ? [{ label: expand.isPending ? "Expanding knowledge…" : "Expand knowledge", disabled: expand.isPending || improve.isPending, onSelect: () => { void expand.run(page.id); } }] : []),
          { label: "Add section", render: (close) => <AddSectionForm page={page} onDone={close} /> },
        ]} />
      </div>
      {expand.error ? <p role="alert" className="mt-2 max-w-sm text-panel">{expand.error}</p> : null}
      {improve.error ? <p role="alert" className="mt-2 max-w-sm text-panel">{improve.error}</p> : null}
    </div>
  );
}
