"use client";

import { Facts, QueryState } from "@/app/(app)/_components/bits";
import { formatDate } from "@/app/(app)/_lib/format";
import { Tooltip } from "@/components/standard/tooltip";
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
import {
  useArticleSuggestions,
  useEntity,
  usePage,
  useSectionLines,
  useSections,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

function PreviewHeader({ label, kind }: { label: string; kind: string }) {
  return (
    <DialogHeader>
      <DialogDescription asChild>
        <p className="text-xs font-medium tracking-wide uppercase">{kind}</p>
      </DialogDescription>
      <DialogTitle>{label}</DialogTitle>
    </DialogHeader>
  );
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
    <div className="flex w-fit max-w-full flex-col gap-4">
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "max-h-[min(60vh,32rem)] overflow-y-auto",
            unitsOpen
              ? "w-[min(32rem,calc(100vw-18rem))]"
              : "w-fit max-w-[min(32rem,calc(100vw-6rem))]",
          )}
        >
          <div className="flex flex-col gap-4 pr-2">{children}</div>
        </div>
        <aside
          aria-label="Knowledge units"
          className={cn(
            "flex shrink-0 flex-col border-l",
            unitsOpen ? "w-56 pl-4" : "pl-2",
          )}
        >
          <div className={cn("flex items-center gap-1", unitsOpen && "pr-8")}>
            {unitsOpen ? (
              <h2 className="min-w-0 flex-1 text-xs font-medium tracking-wide text-faint uppercase">
                Knowledge units
              </h2>
            ) : null}
            <Tooltip content={unitsLabel} side="left">
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
                    !unitsOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
            </Tooltip>
          </div>
          {unitsOpen ? (
            <div className="mt-3 max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
              {sidebar}
            </div>
          ) : null}
        </aside>
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
      <PreviewHeader label={node.label} kind="Entity" />
      <QueryState query={query}>
        {entity ? (
          <>
            <p className="text-body whitespace-pre-wrap">
              {entity.description || "No description yet."}
            </p>
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
      <PreviewHeader label={node.label} kind="Domain" />
      <Facts
        items={[
          ["Path", node.text],
          ["Connections", node.degree],
        ]}
      />
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
  return (
    <PreviewSplit
      sidebar={<UnitLinks units={related} />}
      footer={<OpenPage node={node} />}
    >
      <PreviewHeader
        label={sectionTitle ?? node.label}
        kind={sectionTitle ? "Section" : "Article"}
      />
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
            <QueryState query={sections}>
              <QueryState query={lines}>
                {shown?.length ? (
                  shown.map((section) => {
                    const content =
                      (lines.data ?? [])
                        .filter((line) => line.sectionId === section.id)
                        .map((line) => line.content)
                        .join("\n\n") || section.body;
                    return (
                      <section key={section.id} className="flex flex-col gap-2">
                        {sectionTitle ? null : (
                          <h3 className="font-medium">{section.title}</h3>
                        )}
                        <p className="text-body whitespace-pre-wrap">
                          {content || "No content yet."}
                        </p>
                      </section>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground">
                    {sectionTitle
                      ? "This section is no longer available."
                      : "No content yet."}
                  </p>
                )}
              </QueryState>
            </QueryState>
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

function UnitLinkList({ units }: { units: readonly GraphNode[] }) {
  if (!units.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {units.map((unit) => (
        <li key={unit.id}>
          <Link href={unit.href} className="text-link hover:underline">
            {unit.label}
          </Link>
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
              <h3 className="font-medium">{section.title}</h3>
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
      <PreviewHeader label={title} kind="Suggestion" />
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
          <PagePreview key={page.id} node={page} units={units} />
        ) : null}
        {target?.kind === "section" && page ? (
          <PagePreview
            key={`${page.id}:${target.section}`}
            node={page}
            units={units}
            sectionTitle={target.section}
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
