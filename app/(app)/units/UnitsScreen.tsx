"use client";

import { ActorName } from "@/app/(app)/_components/ActorName";
import { EvidenceBadge } from "@/app/(app)/_components/bits";
import { dateColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatCount } from "@/app/(app)/_lib/format";
import { useHydrated } from "@/app/(app)/_lib/hydrated";
import { readsState } from "@/app/(app)/_lib/reads";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/EmptyState";
import { StatusGlyph, UnitIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import { useSuggestionAttentionCount } from "@/components/shell/useSuggestionAttentionCount";
import { InfoPopover } from "@/components/standard/info-popover";
import { PopoverDescription } from "@/components/ui/popover";
import { contextDescription } from "@/lib/knowledge/contextSelection";
import { useDomains, useEntities, usePages, useUnitDomains, useUnitEntities } from "@/lib/queries";
import { type UnitSummary, useArticleUnitLinks } from "@/lib/queries/screens";
import { useAllUnitSummaries } from "./unitSummaries";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ArticleTreeSelect } from "./ArticleTreeSelect";
import { domainSubtreeIds, filterUnits, type UnitFilters } from "./filterUnits";
import { StatusLegend } from "./StatusLegend";
import { SuggestionsTab } from "./SuggestionsTab";
import { UnitFilterBar } from "./UnitFilterBar";
import { UnitRowMenu } from "./UnitRowMenu";
import { UnitsOverview } from "./UnitsOverview";
import { UnusedUnits } from "./UnusedUnits";
import { useUnitFilters } from "./useUnitFilters";

// COLUMNS: status glyph, content, kind, last changed, and the "…" menu
const COLUMNS = [
  {
    id: "status",
    header: () => <StatusLegend />,
    accessorFn: (unit) => unit.epistemic_status,
    enableSorting: false,
    cell: ({ row }) => <StatusGlyph status={row.original.epistemic_status} />,
  } satisfies ColumnDef<UnitSummary, unknown>,
  textColumn<UnitSummary>("content", "Knowledge", (unit) => `${unit.label ?? ""} ${unit.content}`, (unit) => (
    <div className="max-w-xl whitespace-normal">
      <Link href={`/units/${unit.id}`} className="font-medium text-link hover:underline">{unit.label ?? unit.content}</Link>
      <EvidenceBadge evidence={unit.evidence} className="ml-2 text-xs" />
      <p className="mt-1 line-clamp-2 text-panel text-muted-foreground">{unit.content}</p>
      <p className="mt-1 text-panel text-faint">{unit.context ? contextDescription(unit.context) : "Applicability unspecified"}</p>
    </div>
  )),
  textColumn<UnitSummary>("kind", "Kind", (unit) => unit.kind),
  textColumn<UnitSummary>("by", "Changed by", (unit) => unit.changedBy?.author_id ?? unit.changedBy?.model_version ?? "", (unit) =>
    unit.changedBy ? <ActorName kind={unit.changedBy.author} personId={unit.changedBy.author_id} model={unit.changedBy.model_version} /> : null),
  dateColumn<UnitSummary>("changed", "Last changed", (unit) => unit.last_changed_at, true),
  menuColumn<UnitSummary>((unit) => <UnitRowMenu unit={unit} />),
];

const PENDING = { data: [] as UnitSummary[], isPending: true, error: null };

// A domain's current units, across origins and including its descendants.
export function DomainUnitsTable({ domainId }: { domainId: string }) {
  const units = useAllUnitSummaries();
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const data = useMemo(() => {
    const ids = domainSubtreeIds(domains.data ?? [], domainId);
    const unitIds = new Set((unitDomains.data ?? []).filter((row) => ids.has(row.domain_id)).map((row) => row.unit_id));
    return (units.data ?? []).filter((unit) => !unit.retired_at && unitIds.has(unit.id));
  }, [units.data, domains.data, unitDomains.data, domainId]);
  return <DataTable
    query={{ data, ...readsState([units, domains, unitDomains]) }}
    columns={COLUMNS}
    getRowId={(unit) => unit.id}
    filterPlaceholder="Search units…"
    emptyState={<EmptyState icon={UnitIcon} title="No knowledge units" />}
  />;
}

// UNITS SCREEN: filter bar over the unit table
export function UnitsScreen() {
  const filterState = useUnitFilters();
  const params = useSearchParams();
  const view = params.get("view");
  const overview = view === "overview";
  const unused = view === "unused";
  const suggestions = view === "suggestions";
  // Until hydrated, render what the server did (no data): the cache may already hold reads made elsewhere
  const hydrated = useHydrated();
  const filtered = useFilteredUnits(filterState.filters);
  const query = hydrated ? filtered : PENDING;
  const { data: domains = [] } = useDomains();
  const { data: entities = [] } = useEntities();
  const { data: pages = [] } = usePages();
  const suggestionCount = useSuggestionAttentionCount();
  const activeOrigin = overview || unused || suggestions ? "" : (filterState.filters.origin ?? "internal");
  const tabClass = (active: boolean) => `border-b-2 px-3 py-2.5 text-panel ${active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
  const tabHref = (tab: "overview" | "unused" | "suggestions" | "internal" | "external") => {
    const next = new URLSearchParams(params.toString());
    if (tab === "overview" || tab === "unused" || tab === "suggestions") next.set("view", tab);
    else {
      next.delete("view");
      next.set("origin", tab);
    }
    const query = next.toString();
    return query ? `?${query}` : "/units";
  };
  return (
    <div className="flex flex-col gap-3">
      <nav data-tour="units-origin" aria-label="Unit views" className="flex gap-1 border-b">
        <Link href={tabHref("overview")} aria-current={overview ? "page" : undefined} className={tabClass(overview)}>Overview</Link>
        <Link href={tabHref("unused")} aria-current={unused ? "page" : undefined} className={tabClass(unused)}>Unused</Link>
        {(["internal", "external"] as const).map((origin) => (
          <Link key={origin} href={tabHref(origin)}
            aria-current={activeOrigin === origin ? "page" : undefined}
            className={tabClass(activeOrigin === origin)}>
            {origin === "internal" ? "Internal" : "External"}
          </Link>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 border-l pl-1">
          <Link href={tabHref("suggestions")} aria-current={suggestions ? "page" : undefined} className={`${tabClass(suggestions)} inline-flex items-center gap-1.5`}>
            Suggestions
            <span className={`font-mono tabular-nums ${suggestionCount ? "text-needs-you" : "text-muted-foreground"}`}>{suggestionCount === null ? "—" : formatCount(suggestionCount)}</span>
          </Link>
          <InfoPopover label="About suggestions">
            <PopoverDescription>A run proposes articles from knowledge no article cites.</PopoverDescription>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Groups by meaning, links, shared entities, domains, and sources.</li>
              <li>Likely merges go first. A claim that already points at an article is suggested before the leftovers.</li>
              <li>The AI names a new article, or merges a group into an existing one.</li>
              <li>On the graph, open No article, Orphans, or Linked to suggest only merges, or only new articles.</li>
              <li>Nothing changes until you accept. Apply all accepts every open suggestion, merges first.</li>
              <li>Accepted work goes through Changes and can be undone.</li>
              <li>The Curator leaves knowledge in an open suggestion alone.</li>
            </ul>
          </InfoPopover>
        </span>
      </nav>
      {overview ? <UnitsOverview /> : unused ? <UnusedUnits /> : suggestions ? <SuggestionsTab /> : (
        <>
          <div className="md:hidden"><UnitFilterBar {...filterState} domains={hydrated ? domains : []} entities={hydrated ? entities : []} /></div>
          <DataTable
            query={query}
            columns={COLUMNS}
            getRowId={(unit) => unit.id}
            filterPlaceholder="Search units…"
            toolbarEnd={<ArticleTreeSelect pages={hydrated ? pages : []} value={filterState.filters.article} onChange={(value) => filterState.setFilter("article", value)} />}
            emptyState={<EmptyState icon={UnitIcon} title="No units match" />}
          />
        </>
      )}
    </div>
  );
}

// Units with every filter applied; pending/error from any of the reads it joins
function useFilteredUnits(filters: UnitFilters) {
  const units = useAllUnitSummaries();
  const unitDomains = useUnitDomains();
  const unitEntities = useUnitEntities();
  const domains = useDomains();
  const pages = usePages();
  const articleUnits = useArticleUnitLinks(Boolean(filters.article));
  const articleReady = !filters.article || (pages.isSuccess && articleUnits.isSuccess);
  const reads = [units, unitDomains, unitEntities, domains, ...(filters.article && (pages.error || articleUnits.error) ? [pages, articleUnits] : [])];
  const data = useMemo(
    () =>
      filterUnits(units.data ?? [], articleReady ? filters : { ...filters, article: "" }, {
        unitDomains: unitDomains.data ?? [],
        unitEntities: unitEntities.data ?? [],
        domains: domains.data ?? [],
        pages: pages.data ?? [],
        articleUnits: articleUnits.data ?? [],
      }),
    [units.data, unitDomains.data, unitEntities.data, domains.data, pages.data, articleUnits.data, filters, articleReady],
  );
  return { data, ...readsState(reads) };
}
