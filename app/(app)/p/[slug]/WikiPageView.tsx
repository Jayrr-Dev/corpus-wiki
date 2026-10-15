"use client";

import Link from "next/link";
import { pageAncestors } from "@/lib/living-page/pageHierarchy";
import { articleNavigation } from "@/lib/living-page/articleNavigation";
import { useState } from "react";
import { PageIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBoundary } from "@/components/error";
import { LinePanel, LiveSection } from "@/components/living-page";
import { ArticleSources } from "@/components/living-page/ArticleSources";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/actions/useServerAction";
import type { Tables } from "@/lib/database/types";
import { useEntities, usePages, useSectionLines, useSections } from "@/lib/queries";
import { useArticleEvidence } from "@/lib/queries/articleEvidence";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { expandRelatedArticles, improveArticle } from "@/lib/server-actions/pages";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { AddSectionDialog } from "./AddSectionDialog";
import { SectionMenu } from "./SectionMenu";

export function WikiPageView({ slug }: { slug: string }) {
  const { data: pages = [], isPending, error } = usePages({ filters: { slug } });
  const page = pages[0];
  if (isPending) return <ReadingPane title="Loading…" width="prose" />;
  if (error || !page) return <ReadingPane title="Page" width="prose"><EmptyState icon={PageIcon} title={error ? error.message : "No page with this address"} /></ReadingPane>;
  return <WikiPageBody key={page.id} page={page} />;
}

function WikiPageBody({ page }: { page: Tables<"pages"> }) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const sectionsQuery = useSections({ filters: { page_id: page.id } });
  const sections = sectionsQuery.data ?? [];
  const linesQuery = useSectionLines(page.id);
  const lines = sections.flatMap((section) => (linesQuery.data ?? []).filter((line) => line.sectionId === section.id));
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
  const introduction = sections.find((section) => section.title.toLowerCase() === "overview");
  const topics = sections.filter((section) => section.id !== introduction?.id);
  const error = sectionsQuery.error?.message ?? linesQuery.error?.message;
  const renderSection = (section: Tables<"sections">, hideHeading = false) => (
    <ErrorBoundary key={section.id} where={`The section "${section.title}"`}>
      <LiveSection section={section} lines={lines.filter((line) => line.sectionId === section.id)} selectedLineId={selectedLineId} onSelect={(line) => setSelectedLineId(line.lineId)} evidence={evidence.loading ? undefined : evidence} links={links} hideHeading={hideHeading} menu={<SectionMenu section={section} />} />
    </ErrorBoundary>
  );
  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <header className="mb-6 border-b pb-4">
        <nav aria-label="Page hierarchy" className="mb-3 flex flex-wrap items-center gap-2 text-panel">
          <Link href="/" className="text-link hover:underline">Knowledge</Link>
          {ancestors.map((ancestor) => <span key={ancestor.id} className="inline-flex items-center gap-2"><span aria-hidden="true">/</span><Link href={`/p/${ancestor.slug}`} className="text-link hover:underline">{ancestor.title}</Link></span>)}
          <span aria-hidden="true">/</span><span aria-current="page">{page.title}</span>
        </nav>
        <h1 className="font-serif text-3xl leading-tight">{page.title}</h1>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-panel">
          <span className="text-faint">{evidence.references.length} sources · {topics.length} sections</span>
          <PageActions page={page} />
        </div>
      </header>
      {error ? <p role="alert" className="mb-4 text-panel">Could not load this article: {error}</p> : null}
      {sectionsQuery.isPending || linesQuery.isPending ? <p className="text-panel text-faint">Loading article…</p> : null}
      {!sectionsQuery.isPending && !sections.length ? <EmptyState icon={PageIcon} title="This page has no sections yet" /> : null}
      <div className="grid min-w-0 gap-8 xl:grid-cols-[10rem_minmax(0,1fr)]">
        {sections.length > 0 ? <nav aria-label="Article contents" className="text-panel xl:sticky xl:top-6 xl:self-start">
          <h2 className="mb-2 font-semibold">Contents</h2>
          <ol className="space-y-2 border-l pl-3">
            {introduction ? <li><a className="text-link hover:underline" href={`#section-${introduction.id}`}>Introduction</a></li> : null}
            {topics.map((section, index) => <li key={section.id}><a className="text-link hover:underline" href={`#section-${section.id}`}>{index + 1}. {section.title}</a></li>)}
            <li><a className="text-link hover:underline" href="#article-see-also">See also</a></li>
            <li><a className="text-link hover:underline" href="#article-sources">References</a></li>
          </ol>
        </nav> : null}
        <article className="min-w-0 space-y-8" data-tour="page-body" aria-label={page.title}>
          {children.length ? <section aria-label="Subpages" className="rounded-md border p-4"><h2 className="mb-2 font-semibold">Explore this topic</h2><ul className="grid gap-2 sm:grid-cols-2">{children.map((child) => <li key={child.id}><Link href={`/p/${child.slug}`} className="text-link hover:underline">{child.title}</Link></li>)}</ul></section> : null}
          {introduction ? renderSection(introduction, true) : null}
          {topics.map((section) => renderSection(section))}
          <section id="article-see-also" className="scroll-mt-6 border-t pt-5">
            <h2 className="mb-3 font-serif text-2xl">See also</h2>
            {related.length ? <ul className="list-disc space-y-1 pl-5 text-body">{related.map((other) => <li key={other.id}><Link href={`/p/${other.slug}`} className="text-link hover:underline">{other.title}</Link></li>)}</ul> : <p className="text-panel text-faint">Related articles will appear as the knowledge base grows.</p>}
          </section>
          <ArticleSources references={evidence.references} loading={evidence.loading} error={evidence.error} />
        </article>
      </div>
      {selected ? <RightPanelSlot><LinePanel key={selected.lineRevisionId} line={selected} /></RightPanelSlot> : null}
    </div>
  );
}

function PageActions({ page }: { page: Tables<"pages"> }) {
  const improve = useServerAction(improveArticle);
  const expand = useServerAction(expandRelatedArticles);
  return (
    <div>
      <div className="flex items-center gap-1">
        {page.entity_id ? <Button type="button" size="sm" variant="outline" disabled={improve.isPending || expand.isPending} onClick={() => void improve.run(page.id)}>{improve.isPending ? "Structuring article…" : "Improve article"}</Button> : null}
        {(page.context_entity_id ?? page.entity_id) ? <Button type="button" size="sm" variant="outline" disabled={expand.isPending || improve.isPending} onClick={() => void expand.run(page.id)}>{expand.isPending ? "Expanding knowledge…" : "Expand knowledge"}</Button> : null}
        <AddSectionDialog page={page} /><PageMenu page={page} />
      </div>
      {expand.error ? <p role="alert" className="mt-2 max-w-sm text-panel">{expand.error}</p> : null}
      {improve.error ? <p role="alert" className="mt-2 max-w-sm text-panel">{improve.error}</p> : null}
    </div>
  );
}
