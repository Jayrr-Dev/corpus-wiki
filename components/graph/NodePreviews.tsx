"use client";

import { Facts, QueryState } from "@/app/(app)/_components/bits";
import { formatDate } from "@/app/(app)/_lib/format";
import { LineBlock } from "@/components/living-page/LineBlock";
import { ArticleTextLink, PreviewTabProvider } from "@/components/living-page/previewTabs";
import { UnitPreview } from "@/components/graph/UnitPreview";
import { DynamicTabs } from "@/components/standard/dynamic-tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CircleOpenTarget, GraphNode } from "@/lib/graph";
import { articleNavigation } from "@/lib/living-page/articleNavigation";
import type { ArticleLink } from "@/lib/living-page/articleEvidence";
import {
  useArticleSuggestions,
  useEntities,
  useEntity,
  usePage,
  usePages,
  useSectionLines,
  useSections,
  type ShownLine,
} from "@/lib/queries";
import { useArticleTopicLinks } from "@/lib/queries/articleTopicLinks";
import { useRelatedArticles } from "@/lib/queries/relatedArticles";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";

const PREVIEW_TITLE_CLASS = "text-title font-semibold";

function PreviewKind({ kind }: { kind: string }) {
  return (
    <DialogHeader>
      <DialogDescription asChild>
        <p className="text-xs font-medium tracking-wide uppercase">{kind}</p>
      </DialogDescription>
    </DialogHeader>
  );
}

function PreviewTitle({ children }: { children: string }) {
  return <DialogTitle size="title">{children}</DialogTitle>;
}

function OpenPage({ node }: { node: GraphNode }) {
  return (
    <DialogFooter>
      <Button asChild>
        <Link href={node.href}>Open page</Link>
      </Button>
    </DialogFooter>
  );
}

function PreviewSplit({
  children,
  sidebar,
  footer,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  footer?: ReactNode;
}) {
  const [unitsOpen, setUnitsOpen] = useState(true);
  const unitsLabel = unitsOpen
    ? "Collapse knowledge units"
    : "Expand knowledge units";
  return (
    <div className="flex w-fit max-w-full flex-col gap-4 in-data-[maximized]:h-full in-data-[maximized]:min-h-0 in-data-[maximized]:w-full in-data-[maximized]:max-w-none in-data-[maximized]:flex-1">
      <div className="flex items-start gap-4 in-data-[maximized]:min-h-0 in-data-[maximized]:flex-1 in-data-[maximized]:items-stretch">
        <aside
          aria-label="Knowledge units"
          className={cn(
            "flex shrink-0 flex-col border-r",
            unitsOpen ? "w-56 pr-4" : "pr-2",
            "in-data-[maximized]:min-h-0",
          )}
        >
          <div className="flex items-center gap-1">
            {unitsOpen ? (
              <h2 className="min-w-0 flex-1 text-xs font-medium tracking-wide text-faint uppercase">
                Knowledge units
              </h2>
            ) : null}
            <button
              type="button"
              aria-expanded={unitsOpen}
              aria-label={unitsLabel}
              onClick={() => setUnitsOpen((open) => !open)}
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  unitsOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </div>
          {unitsOpen ? (
            <div className="mt-3 max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable] in-data-[maximized]:max-h-none in-data-[maximized]:min-h-0 in-data-[maximized]:flex-1">
              {sidebar}
            </div>
          ) : null}
        </aside>
        <div
          className={cn(
            "max-h-[min(60vh,32rem)] overflow-y-auto",
            unitsOpen
              ? "w-[min(32rem,calc(100vw-18rem))]"
              : "w-fit max-w-[min(32rem,calc(100vw-6rem))]",
            "in-data-[maximized]:max-h-none in-data-[maximized]:min-h-0 in-data-[maximized]:w-auto in-data-[maximized]:max-w-none in-data-[maximized]:flex-1",
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-4 pl-2",
              unitsOpen && "pr-8",
            )}
          >
            {children}
          </div>
        </div>
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );
}

function listedUnits(units: readonly GraphNode[]) {
  return [...units].sort((a, b) => a.label.localeCompare(b.label));
}

function unitsForEntity(units: readonly GraphNode[], name: string) {
  return listedUnits(
    units.filter(
      (unit) => unit.kind === "unit" && unit.entityNames.includes(name),
    ),
  );
}

function unitsForDomain(units: readonly GraphNode[], path: string) {
  return listedUnits(
    units.filter(
      (unit) =>
        unit.kind === "unit" &&
        unit.domainPaths.some(
          (domain) => domain === path || domain.startsWith(`${path}/`),
        ),
    ),
  );
}

function unitsForPage(
  units: readonly GraphNode[],
  pageTitle: string,
  sectionTitle?: string,
) {
  return listedUnits(
    units.filter((unit) => {
      if (unit.kind !== "unit") return false;
      if (sectionTitle) {
        return unit.pageSections?.some(
          (section) =>
            section.page === pageTitle && section.section === sectionTitle,
        );
      }
      return unit.pageTitles?.includes(pageTitle) ?? false;
    }),
  );
}

export function EntityPreview({
  node,
  units,
}: {
  node: GraphNode;
  units: readonly GraphNode[];
}) {
  const query = useEntity(node.id);
  const entity = query.data;
  const related = unitsForEntity(units, node.label);
  return (
    <PreviewSplit
      sidebar={<UnitLinks units={related} />}
      footer={<OpenPage node={node} />}
    >
      <PreviewKind kind="Entity" />
      {entity && !query.isPending && !query.error ? null : (
        <DialogTitle className="sr-only">{node.label}</DialogTitle>
      )}
      <QueryState query={query}>
        {entity ? (
          <>
            <Facts
              items={[
                ["Type", entity.type],
                ...(entity.aliases.length
                  ? [["Aliases", entity.aliases.join(", ")] as [string, string]]
                  : []),
                ["Connections", node.degree],
                ["Created", formatDate(entity.created_at)],
              ]}
            />
            <PreviewTitle>{node.label}</PreviewTitle>
            <p className="text-body whitespace-pre-wrap">
              {entity.description || "No description yet."}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">
            This entity is no longer available.
          </p>
        )}
      </QueryState>
    </PreviewSplit>
  );
}

export function DomainPreview({
  node,
  units,
}: {
  node: GraphNode;
  units: readonly GraphNode[];
}) {
  const related = unitsForDomain(units, node.text);
  return (
    <PreviewSplit
      sidebar={<UnitLinks units={related} />}
      footer={<OpenPage node={node} />}
    >
      <PreviewKind kind="Domain" />
      <Facts
        items={[
          ["Path", node.text],
          ["Connections", node.degree],
        ]}
      />
      <PreviewTitle>{node.label}</PreviewTitle>
    </PreviewSplit>
  );
}

export function PagePreview({
  node,
  units,
  sectionTitle,
}: {
  node: GraphNode;
  units: readonly GraphNode[];
  sectionTitle?: string;
}) {
  const query = usePage(node.id);
  const sections = useSections({ filters: { page_id: node.id } });
  const lines = useSectionLines(node.id);
  const shown = sections.data?.filter((section) =>
    sectionTitle ? section.title === sectionTitle : true,
  );
  const related = unitsForPage(units, node.label, sectionTitle);
  const title = sectionTitle ?? node.label;
  const showTitle = Boolean(query.data && !query.isPending && !query.error);
  const allPages = usePages();
  const entities = useEntities();
  const allSections = useSections();
  const pageText = (lines.data ?? []).map((line) => line.content).join(" ");
  const navigation = useMemo(
    () =>
      articleNavigation(
        allPages.data ?? [],
        entities.data ?? [],
        allSections.data ?? [],
        node.id,
        pageText,
      ),
    [allPages.data, entities.data, allSections.data, node.id, pageText],
  );
  const navigationContext = useMemo(
    () => JSON.stringify([allPages.data, allSections.data, entities.data]),
    [allPages.data, allSections.data, entities.data],
  );
  const navigationReady =
    !!allPages.data && !!allSections.data && !!entities.data;
  const topicLinks = useArticleTopicLinks(
    node.id,
    navigationContext,
    navigationReady,
  );
  const articleLinks = useMemo(
    () => [...navigation.links, ...(topicLinks.data ?? [])],
    [navigation.links, topicLinks.data],
  );
  const recommendations = useRelatedArticles(
    node.id,
    navigationContext,
    navigationReady,
  );
  const seeAlso = recommendations.data ?? navigation.related;
  return (
    <PreviewSplit
      sidebar={<UnitLinks units={related} />}
      footer={<OpenPage node={node} />}
    >
      <PreviewKind kind={sectionTitle ? "Section" : "Article"} />
      {showTitle ? null : (
        <DialogTitle className="sr-only">{title}</DialogTitle>
      )}
      <QueryState query={query}>
        {query.data ? (
          <>
            <Facts
              items={[
                ...(sectionTitle
                  ? [["Article", node.label] as [string, string]]
                  : []),
                ...(node.domainPaths.length
                  ? [
                      ["Domains", node.domainPaths.join(", ")] as [
                        string,
                        string,
                      ],
                    ]
                  : []),
                ["Connections", node.degree],
                ["Created", formatDate(query.data.created_at)],
              ]}
            />
            <PreviewTitle>{title}</PreviewTitle>
            <QueryState query={sections}>
              <QueryState query={lines}>
                {shown?.length ? (
                  shown.map((section) => (
                    <section key={section.id} className="flex flex-col gap-2">
                      {sectionTitle ? null : (
                        <h3 className={PREVIEW_TITLE_CLASS}>{section.title}</h3>
                      )}
                      <SectionBody
                        sectionId={section.id}
                        body={section.body}
                        lines={lines.data ?? []}
                        links={articleLinks}
                      />
                    </section>
                  ))
                ) : (
                  <p className="text-muted-foreground">
                    {sectionTitle
                      ? "This section is no longer available."
                      : "No content yet."}
                  </p>
                )}
              </QueryState>
            </QueryState>
            <SeeAlso
              articles={seeAlso}
              pending={recommendations.isPending}
              failed={!!recommendations.error}
              onRetry={() => void recommendations.refetch()}
            />
          </>
        ) : (
          <p className="text-muted-foreground">
            This article is no longer available.
          </p>
        )}
      </QueryState>
    </PreviewSplit>
  );
}

function SectionBody({
  sectionId,
  body,
  lines,
  links,
}: {
  sectionId: string;
  body: string | null;
  lines: readonly ShownLine[];
  links: ArticleLink[];
}) {
  const sectionLines = lines.filter((line) => line.sectionId === sectionId);
  if (sectionLines.length) {
    return (
      <>
        {sectionLines.map((line) => (
          <LineBlock key={line.lineId} content={line.content} links={links} />
        ))}
      </>
    );
  }
  if (body) return <LineBlock content={body} links={links} />;
  return <p className="text-muted-foreground">No content yet.</p>;
}

function SeeAlso({
  articles,
  pending,
  failed,
  onRetry,
}: {
  articles: { id: string; slug: string; title: string }[];
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (!articles.length && !pending && !failed) return null;
  return (
    <section className="border-t pt-4">
      <h3 className="mb-2 font-serif text-title">See also</h3>
      {pending && !articles.length ? (
        <p role="status" className="text-panel text-faint">
          Finding related articles…
        </p>
      ) : null}
      {failed ? (
        <p className="mb-2 text-panel text-faint">
          Related articles are temporarily unavailable.{" "}
          <button
            type="button"
            className="text-link hover:underline"
            onClick={onRetry}
          >
            Retry
          </button>
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-5 text-body">
        {articles.map((other) => (
          <li key={other.id}>
            <ArticleTextLink
              href={`/p/${other.slug}`}
              label={other.title}
              className="text-link hover:underline"
            >
              {other.title}
            </ArticleTextLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UnitLinkList({ units }: { units: readonly GraphNode[] }) {
  if (!units.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {units.map((unit) => (
        <li key={unit.id}>
          <ArticleTextLink
            href={unit.href}
            label={unit.label}
            className="text-link hover:underline"
          >
            {unit.label}
          </ArticleTextLink>
        </li>
      ))}
    </ul>
  );
}

function UnitLinks({ units }: { units: readonly GraphNode[] }) {
  if (!units.length) {
    return <p className="text-muted-foreground">No knowledge units.</p>;
  }
  return <UnitLinkList units={units} />;
}

function plannedSections(
  value: unknown,
): { title: string; unitIds: string[] }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((section) => {
    if (!section || typeof section !== "object") return [];
    const record = section as { title?: unknown; unitIds?: unknown };
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const unitIds = Array.isArray(record.unitIds)
      ? record.unitIds.filter((id): id is string => typeof id === "string")
      : [];
    return title ? [{ title, unitIds }] : [];
  });
}

function RecommendationPreview({
  title,
  units,
}: {
  title: string;
  units: readonly GraphNode[];
}) {
  const query = useArticleSuggestions();
  const suggestion = query.data?.find(
    (row) => row.status === "pending" && row.title.trim() === title,
  );
  const planned = plannedSections(suggestion?.sections);
  const placed = new Set(planned.flatMap((section) => section.unitIds));
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const rest = units.filter((unit) => !placed.has(unit.id));
  return (
    <PreviewSplit
      sidebar={
        <QueryState query={query}>
          {planned.map((section) => (
            <section key={section.title} className="flex flex-col gap-2">
              <h3 className={PREVIEW_TITLE_CLASS}>{section.title}</h3>
              <UnitLinkList
                units={section.unitIds.flatMap((id) => byId.get(id) ?? [])}
              />
            </section>
          ))}
          {rest.length ? <UnitLinkList units={rest} /> : null}
          {!planned.length && !rest.length ? (
            <p className="text-muted-foreground">
              No knowledge is in this suggestion.
            </p>
          ) : null}
        </QueryState>
      }
      footer={
        <DialogFooter>
          <Button asChild>
            <Link href="/units?view=suggestions">Open suggestions</Link>
          </Button>
        </DialogFooter>
      }
    >
      <PreviewKind kind="Suggestion" />
      <PreviewTitle>{title}</PreviewTitle>
      <QueryState query={query}>
        {suggestion?.rationale ? (
          <p className="text-body whitespace-pre-wrap">
            {suggestion.rationale}
          </p>
        ) : null}
      </QueryState>
    </PreviewSplit>
  );
}

type PreviewTab = {
  id: string;
  label: string;
  closable?: boolean;
} & (
  | { kind: "page"; pageId: string; sectionTitle?: string }
  | { kind: "unit"; unitId: string }
);

function ArticlePreviewTabs({
  page,
  sectionTitle,
  pages,
  units,
}: {
  page: GraphNode;
  sectionTitle?: string;
  pages: readonly GraphNode[];
  units: readonly GraphNode[];
}) {
  const first: PreviewTab = {
    kind: "page",
    id: sectionTitle ? `${page.id}:${sectionTitle}` : page.id,
    label: sectionTitle ?? page.label,
    pageId: page.id,
    sectionTitle,
    closable: false,
  };
  const [tabs, setTabs] = useState<PreviewTab[]>([first]);
  const [active, setActive] = useState(first.id);
  const openTarget = useCallback(
    (href: string, label: string) => {
      const path = href.split(/[?#]/)[0] ?? href;
      const pageMatch = pages.find(
        (node) => node.kind === "page" && node.href === path,
      );
      if (pageMatch) {
        setTabs((current) =>
          current.some((tab) => tab.id === pageMatch.id)
            ? current
            : [
                ...current,
                {
                  kind: "page",
                  id: pageMatch.id,
                  label: pageMatch.label || label,
                  pageId: pageMatch.id,
                },
              ],
        );
        setActive(pageMatch.id);
        return;
      }
      const unitMatch = units.find(
        (node) => node.kind === "unit" && node.href === path,
      );
      if (!unitMatch) {
        window.location.assign(href);
        return;
      }
      const id = `unit:${unitMatch.id}`;
      setTabs((current) =>
        current.some((tab) => tab.id === id)
          ? current
          : [
              ...current,
              {
                kind: "unit",
                id,
                label: unitMatch.label || label,
                unitId: unitMatch.id,
              },
            ],
      );
      setActive(id);
    },
    [pages, units],
  );
  const shown = tabs.find((tab) => tab.id === active) ?? tabs[0] ?? first;
  const node =
    shown.kind === "page"
      ? (pages.find((item) => item.id === shown.pageId) ?? page)
      : null;
  const unit =
    shown.kind === "unit"
      ? units.find((item) => item.id === shown.unitId)
      : null;
  return (
    <PreviewTabProvider onOpen={openTarget}>
      <DynamicTabs
        items={tabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          closable: tab.closable,
        }))}
        value={active}
        onValueChange={setActive}
        onClose={(id) =>
          setTabs((current) => current.filter((tab) => tab.id !== id))
        }
        aria-label="Open articles"
        className="in-data-[maximized]:h-full in-data-[maximized]:min-h-0 in-data-[maximized]:flex-1 [&_[data-slot=dynamic-tabs-bar]]:pr-20"
      >
        {shown.kind === "unit" && unit ? (
          <UnitPreview key={shown.id} node={unit} />
        ) : null}
        {shown.kind === "page" && node ? (
          <PagePreview
            key={shown.id}
            node={node}
            units={units}
            sectionTitle={shown.sectionTitle}
          />
        ) : null}
      </DynamicTabs>
    </PreviewTabProvider>
  );
}

// SECOND CLICK: the article, one section, or a pending suggestion
export function CirclePreviewDialog({
  target,
  pages,
  units,
  onClose,
}: {
  target: CircleOpenTarget | null;
  pages: readonly GraphNode[];
  units: readonly GraphNode[];
  onClose: () => void;
}) {
  const page =
    target && target.kind !== "recommendation"
      ? pages.find(
          (node) =>
            node.kind === "page" &&
            node.label ===
              (target.kind === "page" ? target.title : target.page),
        )
      : undefined;
  const suggested =
    target?.kind === "recommendation"
      ? units.filter(
          (node) =>
            node.kind === "unit" &&
            node.recommendedTitle === target.title &&
            !node.pageTitles?.length,
        )
      : [];
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(isOpen) => (isOpen ? null : onClose())}
    >
      <DialogContent className="w-fit max-w-[min(52rem,calc(100%-2rem))] sm:max-w-[min(52rem,calc(100%-2rem))]">
        {target?.kind === "page" && page ? (
          <ArticlePreviewTabs
            key={page.id}
            page={page}
            pages={pages}
            units={units}
          />
        ) : null}
        {target?.kind === "section" && page ? (
          <ArticlePreviewTabs
            key={`${page.id}:${target.section}`}
            page={page}
            sectionTitle={target.section}
            pages={pages}
            units={units}
          />
        ) : null}
        {target && target.kind !== "recommendation" && !page ? (
          <PreviewSplit sidebar={<UnitLinks units={[]} />}>
            <DialogHeader>
              <DialogTitle>Article</DialogTitle>
              <DialogDescription className="sr-only">
                This article is no longer available.
              </DialogDescription>
            </DialogHeader>
            <p className="text-muted-foreground">
              This article is no longer available.
            </p>
          </PreviewSplit>
        ) : null}
        {target?.kind === "recommendation" ? (
          <RecommendationPreview title={target.title} units={suggested} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
