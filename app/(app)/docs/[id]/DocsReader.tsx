"use client";

import { ChevronRight, Filter } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useServerAction } from "@/components/actions/useServerAction";
import { ComposerFigure } from "@/components/living-page/ComposerFigure";
import { PublishingDialog } from "@/components/publishing/PublishingDialog";
import { InfoHint } from "@/components/standard/info-hint";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { claimsByUnit, pageHeadings, pageTree, type ReaderSection, readerSections, subtaskAnchor } from "@/lib/docs/reader";
import { type TopicNavItem, topicNavKeyFor } from "@/lib/docs/topicNav";
import { type DocClaimRow, type DocPageRow, type DocSetView, isPageStale, isPageUnwritten, isPageWriting } from "@/lib/docs/types";
import { useSectionLines } from "@/lib/queries";
import { useComposerFigures } from "@/lib/queries/composer";
import { illustrateArticle } from "@/lib/server-actions/composer";
import { cn } from "@/lib/utils";
import { DocsTopicNav } from "../DocsTopicNav";
import { DocBlockView } from "./DocBlockView";

// =====================================================================
// DOCS READER, laid out like MDN: breadcrumbs with Rebuild, Export and
// Publish in the top bar; a filterable page tree with folding groups on
// the left, the page in the center, "In this article" on the right with
// the heading you are reading marked. A page
// whose sources changed shows a dot in the tree and "Sources changed"
// with Rebuild page. Refreshes itself while pages are being written.
// =====================================================================

export function DocsReader({ set, pageId, article = false, topics }: { set: DocSetView; pageId: string | null; article?: boolean; topics: TopicNavItem[] }) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [rebuilding, setRebuilding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const page = set.pages.find((item) => item.id === pageId) ?? null;
  const claims = useMemo(() => claimsByUnit(set), [set]);
  const sections = useMemo(() => (page ? readerSections(page) : []), [page]);
  // a section named like the page has no heading of its own (see DocPageSections), so it is not listed
  const headings = pageHeadings(sections).filter((heading) => !(heading.level === 2 && page && heading.text.trim().toLowerCase() === page.title.trim().toLowerCase()));
  const activeHeading = useActiveHeading(headings.map((heading) => heading.anchor).join(" "));
  const setWriting = set.status === "writing";
  const writing = setWriting || set.pages.some((item) => isPageWriting(item, false));
  // a page whose first build failed once the set finished; it needs a rebuild like a stale one
  const needsRebuild = (item: DocSetView["pages"][number]) => isPageStale(item) || (!setWriting && isPageUnwritten(item));
  const rebuildLabel = (item: DocSetView["pages"][number]) => (isPageStale(item) ? "Sources changed" : "Not written");

  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [writing, router]);

  const rebuild = async (target: string) => {
    setRebuilding(target); setError(null);
    try {
      const response = await fetch(`/api/docs/${set.id}/rebuild`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target === "all" ? {} : { pageId: target }) });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error ?? "Could not rebuild.");
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRebuilding(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col">
      {topics.length ? <div className="border-b px-4 py-1.5"><DocsTopicNav items={topics} activeKey={topicNavKeyFor(topics, set.id)} /></div> : null}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-2">
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-1 text-panel">
            <li><Link href="/docs" className="text-muted-foreground hover:text-foreground hover:underline">Docs</Link></li>
            <li aria-hidden><ChevronRight className="size-3.5 text-muted-foreground" /></li>
            <li className="min-w-0">
              {page ? <Link href={`/docs/${set.id}`} className="text-muted-foreground hover:text-foreground hover:underline">{set.title}</Link> : <span aria-current="page">{set.title}</span>}
            </li>
            {page ? (
              <>
                <li aria-hidden><ChevronRight className="size-3.5 text-muted-foreground" /></li>
                <li className="min-w-0" aria-current="page">{page.title}</li>
              </>
            ) : null}
          </ol>
        </nav>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={writing || rebuilding !== null} onClick={() => rebuild("all")}>{writing ? "Writing…" : "Rebuild"}</Button>
          <Button size="sm" variant="outline" asChild><Link href={article ? `/docs/${set.id}` : `/docs/${set.id}?view=article`}>{article ? "Pages" : "One article"}</Link></Button>
          <Button size="sm" variant="outline" asChild><a href={`/api/docs/${set.id}/export`} download>Export</a></Button>
          <Button size="sm" variant="outline" onClick={() => setPublishing(true)}>Publish</Button>
        </div>
      </header>
      {set.status === "failed" && set.error ? <p role="alert" className="px-6 pt-4 text-panel text-destructive">{set.error}</p> : null}
      {error ? <p role="alert" className="px-6 pt-4 text-panel text-destructive">{error}</p> : null}

      {article ? (
        <article className="mx-auto grid w-full max-w-3xl gap-10 px-6 py-6">
          <h1 className="text-3xl font-semibold tracking-tight">{set.title}</h1>
          {set.pages.map((item) => <ArticlePage key={item.id} page={item} claims={claims} />)}
        </article>
      ) : (
      <div className="grid gap-8 px-6 py-6 md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        <PageNav set={set} pageId={page?.id ?? null} needsRebuild={needsRebuild} rebuildLabel={rebuildLabel} />

        <article className="min-w-0">
          {page ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
                {isPageWriting(page, setWriting) || needsRebuild(page) ? null : <IllustratePage pageId={page.id} title={page.title} />}
              </div>
              {needsRebuild(page) ? (
                <div className="flex flex-wrap items-center gap-3 text-panel">
                  <span className="text-destructive">{rebuildLabel(page)}</span>
                  <Button size="sm" variant="outline" disabled={writing || rebuilding !== null} onClick={() => rebuild(page.id)}>Rebuild page</Button>
                </div>
              ) : null}
              {isPageWriting(page, setWriting) ? <p className="text-panel text-muted-foreground">Writing this page…</p> : null}
              <DocPageSections key={page.id} page={page} sections={sections} claims={claims} />
            </div>
          ) : (
            <p className="text-panel text-muted-foreground">No pages yet.</p>
          )}
        </article>

        <aside aria-label="In this article" className="hidden xl:sticky xl:top-4 xl:block xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
          {headings.length ? (
            <>
              <p className="mb-3 text-base font-semibold">In this article</p>
              <ul className="grid text-panel">
                {headings.map((heading) => (
                  <li key={heading.anchor}>
                    <a href={`#${heading.anchor}`} aria-current={heading.anchor === activeHeading ? "location" : undefined}
                      className={cn("block border-l-2 py-1 pr-2 text-muted-foreground hover:text-foreground", heading.level === 3 ? "pl-6" : "pl-3",
                        heading.anchor === activeHeading ? "border-primary bg-muted font-medium text-foreground" : "border-border")}>
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
      )}
      <PublishingDialog open={publishing} onOpenChange={setPublishing} />
    </div>
  );
}

// PAGE LIST: the set's title on top, a filter box, then pages under task groups that fold open and shut.
// Filtering opens every group and hides pages whose title does not match.
function PageNav({ set, pageId, needsRebuild, rebuildLabel }: {
  set: DocSetView; pageId: string | null;
  needsRebuild: (item: DocPageRow) => boolean; rebuildLabel: (item: DocPageRow) => string;
}) {
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const query = filter.trim().toLowerCase();
  const groups = pageTree(set.pages)
    .map((group) => ({ ...group, pages: query ? group.pages.filter((item) => item.title.toLowerCase().includes(query)) : group.pages }))
    .filter((group) => group.pages.length);
  const toggle = (label: string) => setClosed((current) => {
    const next = new Set(current);
    if (!next.delete(label)) next.add(label);
    return next;
  });

  const pageLink = (item: DocPageRow) => (
    <Link href={`/docs/${set.id}?page=${item.id}`} aria-current={item.id === pageId ? "page" : undefined}
      className={cn("flex items-center justify-between gap-2 border-l-2 py-1 pr-2 pl-3 text-panel hover:bg-muted",
        item.id === pageId ? "border-primary bg-muted font-medium" : "border-transparent")}>
      <span className="min-w-0 break-words">{item.title}</span>
      {needsRebuild(item) ? (
        <Tooltip content={rebuildLabel(item)}>
          <span aria-label={rebuildLabel(item)} className="size-2 shrink-0 rounded-full bg-destructive" />
        </Tooltip>
      ) : null}
    </Link>
  );

  return (
    <nav aria-label="Pages" className="grid min-w-0 content-start gap-3 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:self-start md:overflow-y-auto md:pr-2">
      <div className="relative [&_input]:pl-8">
        <Filter aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter" aria-label="Filter pages" />
      </div>
      <Link href={`/docs/${set.id}`} className="border-l-2 border-transparent px-3 py-1 font-semibold hover:underline">{set.title}</Link>
      {groups.length ? groups.map((group) => {
        if (!group.label) return <ul key="pages" className="grid">{group.pages.map((item) => <li key={item.id}>{pageLink(item)}</li>)}</ul>;
        const open = Boolean(query) || !closed.has(group.label);
        return (
          <div key={group.label}>
            <button type="button" aria-expanded={open} onClick={() => toggle(group.label!)}
              className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-panel font-semibold hover:bg-muted">
              <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
              {group.label}
            </button>
            {open ? <ul className="mt-0.5 ml-2.5 grid">{group.pages.map((item) => <li key={item.id}>{pageLink(item)}</li>)}</ul> : null}
          </div>
        );
      }) : <p className="px-3 text-panel text-muted-foreground">No pages match.</p>}
    </nav>
  );
}

// ONE ARTICLE: one page of the set, with its title as a heading, in set order
function ArticlePage({ page, claims }: { page: DocPageRow; claims: ReadonlyMap<string, DocClaimRow> }) {
  const sections = useMemo(() => readerSections(page), [page]);
  return (
    <section className="grid gap-3">
      <h2 className="text-2xl font-semibold tracking-tight">{page.title}</h2>
      <DocPageSections page={page} sections={sections} claims={claims} />
    </section>
  );
}

// The heading the reader is on: the last one whose top has scrolled past the top of the screen.
// Listens in the capture phase so it hears scrolls inside the app's scroll pane as well as the window.
function useActiveHeading(anchorKey: string): string | null {
  const [active, setActive] = useState<string | null>(null);
  const anchors = anchorKey ? anchorKey.split(" ") : [];
  useEffect(() => {
    const list = anchorKey ? anchorKey.split(" ") : [];
    if (!list.length) return;
    const update = () => {
      let current: string | null = list[0] ?? null;
      for (const anchor of list) {
        const top = document.getElementById(anchor)?.getBoundingClientRect().top;
        if (top !== undefined && top <= 96) current = anchor;
      }
      setActive(current);
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { capture: true, passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", update, { capture: true }); };
  }, [anchorKey]);
  // before the first scroll, or after the page changes, the first heading is current
  return active && anchors.includes(active) ? active : (anchors[0] ?? null);
}

// THE PAGE'S SECTIONS with Composer's figures: each figure sits at the top of the section its line is
// in, beside the steps on wider screens. Only figures whose cited lines are unchanged are shown.
function DocPageSections({ page, sections, claims }: { page: DocPageRow; sections: ReaderSection[]; claims: ReadonlyMap<string, DocClaimRow> }) {
  const lines = useSectionLines(page.id).data ?? [];
  const figures = useComposerFigures(page.id, lines).data ?? [];
  const sectionOf = new Map(sections.flatMap((section) => section.blocks.map(({ key }) => [key, section.id] as const)));
  const figuresIn = (sectionId: string) => figures.filter((figure) => (figure.sectionId ?? sectionOf.get(figure.after)) === sectionId);
  return sections.map((section) => (
    <section key={section.id} aria-labelledby={section.intro ? undefined : section.anchor} className="grid gap-3">
      {section.intro || section.title.trim().toLowerCase() === page.title.trim().toLowerCase()
        ? null
        : <h2 id={section.anchor} className="scroll-mt-20 pt-6 text-2xl font-semibold tracking-tight">{section.title}</h2>}
      <div className="flow-root space-y-3">
        {figuresIn(section.id).map((figure) => <ComposerFigure key={figure.id} figure={figure} />)}
        {section.blocks.map(({ key, block }) => <DocBlockView key={key} block={block} claims={claims} anchor={block.type === "heading" ? subtaskAnchor(key) : undefined} />)}
      </div>
    </section>
  ));
}

// ILLUSTRATE: asks Composer for figures on this page now (it also runs on its own after a page is written)
function IllustratePage({ pageId, title }: { pageId: string; title: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const compose = useServerAction(illustrateArticle, { refreshTables: ["lines", "assets"], progress: { title: `Illustrating “${title}”`, detail: "Composer is choosing, drawing and reviewing figures…" } });
  const illustrate = () => {
    setMessage(null);
    void compose.run(pageId).then((result) => {
      if (result.ok) setMessage(result.figures ? `Added ${result.figures} figure${result.figures === 1 ? "" : "s"}.` : result.message ?? "No figures needed.");
    });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" disabled={compose.isPending} onClick={illustrate}>{compose.isPending ? "Illustrating…" : "Illustrate"}</Button>
        <InfoHint>Composer adds up to three figures where a picture makes the steps clearer.</InfoHint>
      </div>
      {compose.error ? <p role="alert" className="max-w-xs text-right text-panel text-destructive">{compose.error}</p> : null}
      {message ? <p className="max-w-xs text-right text-panel text-muted-foreground">{message}</p> : null}
    </div>
  );
}
