"use client";

import { TextLink } from "@/app/(app)/_components/bits";
import { countColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { formatCount, statusLabel } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { PageIcon } from "@/components/icons";
import { InfoPopover } from "@/components/standard/info-popover";
import { PopoverDescription } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ArticleKnowledge, type SectionKnowledge, useArticleKnowledge, useKnowledgeUsage, useSectionKnowledge } from "@/lib/queries/screens";
import { useMemo, useState } from "react";

type ArticleRow = ArticleKnowledge & { sections: SectionKnowledge[] };

function ArticleSections({ sections }: { sections: SectionKnowledge[] }) {
  const rows = sections.flatMap((section) => section.units.map((unit, index) => ({ section, unit, first: index === 0 })));
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">Section</TableHead>
          <TableHead>Knowledge</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ section, unit, first }) => (
          <TableRow key={`${section.sectionId}-${unit.id}`}>
            <TableCell className="whitespace-normal align-top">{first ? section.title : ""}</TableCell>
            <TableCell className="whitespace-normal align-top"><TextLink className="whitespace-normal" href={`/units/${unit.id}`}>{unit.title ?? unit.content}</TextLink></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// OVERVIEW: how much knowledge is in articles, then one row per article
export function UnitsOverview() {
  const usage = useKnowledgeUsage();
  const articles = useArticleKnowledge();
  const sectionKnowledge = useSectionKnowledge();
  const [openId, setOpenId] = useState<string | null>(null);
  const totals = usage.data;
  const rows = useMemo(() => {
    const byPage = new Map<string, SectionKnowledge[]>();
    for (const section of sectionKnowledge.data ?? []) {
      const list = byPage.get(section.pageId) ?? [];
      list.push(section);
      byPage.set(section.pageId, list);
    }
    return (articles.data ?? []).map((article) => ({
      ...article,
      sections: (byPage.get(article.pageId) ?? []).sort((a, b) => a.position - b.position),
    }));
  }, [articles.data, sectionKnowledge.data]);
  const columns = useMemo(() => [
    linkColumn<ArticleRow>("article", "Article", (article) => article.title, (article) => `/p/${article.slug}`),
    textColumn<ArticleRow>("type", "Type", (article) => statusLabel(article.articleType)),
    countColumn<ArticleRow>("knowledge", "Knowledge", (article) => article.units),
    textColumn<ArticleRow>("sections", "Sections", (article) => article.sections.map((section) => `${section.title} ${section.units.map((unit) => unit.title ?? unit.content).join(" ")}`).join(" "), (article) => (
      <button
        type="button"
        aria-expanded={openId === article.pageId}
        className="text-link hover:underline"
        onClick={() => setOpenId((current) => current === article.pageId ? null : article.pageId)}
      >
        {openId === article.pageId ? "Hide" : `${article.sections.length} sections`}
      </button>
    )),
  ], [openId]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="font-mono text-panel">{totals ? `${formatCount(totals.usedUnits)} of ${formatCount(totals.units)}` : "—"}</p>
        <InfoPopover label="About knowledge in articles">
          <PopoverDescription>Open an article to see each section and the knowledge it cites.</PopoverDescription>
        </InfoPopover>
      </div>
      <DataTable
        query={{ data: rows, ...readsState([usage, articles, sectionKnowledge]) }}
        columns={columns}
        getRowId={(article) => article.pageId}
        filterPlaceholder="Search articles…"
        emptyState={<EmptyState icon={PageIcon} title="No articles yet" />}
        detail={(article) => openId === article.pageId ? <ArticleSections sections={article.sections} /> : null}
      />
    </div>
  );
}
