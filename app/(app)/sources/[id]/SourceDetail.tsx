"use client";

import { Facts, Note, QueryState, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { formatBytes, formatDate } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { usePersonName } from "@/app/(app)/_lib/useActorLabel";
import { uploaderLabel } from "@/app/(app)/_lib/uploaderLabel";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SourceState } from "../SourceState";

import type { Tables } from "@/lib/database/types";

import { Tooltip } from "@/components/standard/tooltip";
import { UploadWorkflowStatus, useUploadWorkflows } from "@/components/upload/UploadWorkflowStatus";
import { glossaryAnchor } from "@/lib/glossary/entries";
import { useShiftEvents, useSource, useSources } from "@/lib/queries";
import { useSourceUnitIds, useUnitSummaries } from "@/lib/queries/screens";
import { SourcePreview } from "../SourcePreview";
import { SourceRowMenu } from "../SourceRowMenu";
import { SourceFigures } from "./SourceFigures";
import { SourcePassages } from "./SourcePassages";
import { useOneSourceUsage, useSourceArticles, useSourceReach } from "./sourceReads";

// SOURCE DETAIL: what the file is, a preview of it, the pictures read from it, the articles built on it, the knowledge that cites it,
// the definitions, entities and domains that knowledge produced, then its passages
export function SourceDetail({ sourceId }: { sourceId: string }) {
  const query = useSource(sourceId);
  const source = query.data;
  return (
    <QueryState query={query}>
      {source ? (
        <div className="flex flex-col gap-6">
          <SourceHeader source={source} />
          {source.origin === "internal" ? <SourceUploadProgress sourceId={source.id} active={!source.archived_at} /> : null}
          <Section title="Preview">
            <SourcePreview source={source} />
          </Section>
          <SourceFigures sourceId={source.id} />
          <SourceArticles sourceId={source.id} />
          <SourceKnowledge sourceId={source.id} />
          <SourceReachLists sourceId={source.id} />
          <SourcePassages sourceId={source.id} />
        </div>
      ) : (
        <Note>No source with this id. It may have been deleted.</Note>
      )}
    </QueryState>
  );
}

function SourceUploadProgress({ sourceId, active }: { sourceId: string; active: boolean }) {
  const events = useShiftEvents({ filters: { source_id: sourceId, cause: "upload" }, limit: 1 });
  const latest = events.data?.[0];
  const eventId = latest?.id;
  const workflows = useUploadWorkflows(latest ? [latest.id] : []);
  const queryClient = useQueryClient();
  const workflow = workflows.data?.[0];
  const progress = workflow?.progress?.done;
  const state = workflow?.state;
  const lastRefresh = useRef(0);
  // Refresh once per durable batch (also on resume/finish), rather than refetching
  // a large book after every inserted row or waiting for a manual page reload.
  useEffect(() => {
    if (!eventId) return;
    const refresh = () => {
      lastRefresh.current = Date.now();
      for (const table of ["units", "actions", "entities", "domains"] as const) {
        void queryClient.invalidateQueries({ queryKey: ["table", table] });
      }
    };
    const delay = state === "running" ? Math.max(0, 5000 - (Date.now() - lastRefresh.current)) : 0;
    if (!delay) { refresh(); return; }
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [eventId, progress, state, queryClient]);
  return latest ? <div className="flex flex-col gap-2"><UploadWorkflowStatus eventId={latest.id} allowRetry={active} />
    {state === "running" ? <Note>New knowledge is saved as each batch finishes. Duplicate checks, topic filing and article updates continue afterward.</Note> : null}
  </div> : null;
}

// HEADER: title, state, versions, dates, type and how much knowledge and article text cites it, with the source's "…" menu
function SourceHeader({ source }: { source: Tables<"sources"> }) {

  const versions = useSources();
  const newer = versions.data?.find((other) => other.id === source.replaced_by_id);
  const older = (versions.data ?? []).filter((other) => other.replaced_by_id === source.id);
  // Who uploaded it: the person on its first upload event (reruns are later events)
  const firstUpload = useShiftEvents({ filters: { source_id: source.id, cause: "upload" }, ascending: true, limit: 1 }).data?.[0];
  const uploaderName = usePersonName(firstUpload?.person_id);
  const uploader = uploaderLabel(firstUpload && { person_id: firstUpload.person_id, via: firstUpload.via }, uploaderName);
  const usage = useOneSourceUsage(source.id).data;
  const reach = useSourceReach(source.id).data;
  const facts: [string, ReactNode][] = [["State", <SourceState key="state" source={source} />]];
  if (newer) facts.push(["Replaced by", <TextLink key="newer" href={`/sources/${newer.id}`}>{newer.title}</TextLink>]);
  if (older.length > 0) {
    facts.push(["Replaces", (
      <span key="older" className="flex flex-col">
        {older.map((other) => <TextLink key={other.id} href={`/sources/${other.id}`}>{other.title}</TextLink>)}
      </span>
    )]);
  }
  facts.push(
    ["Source date", <span key="date" className="font-mono">{formatDate(source.source_date)}</span>],
    ["Uploaded", <span key="uploaded" className="font-mono"><DateTime iso={source.created_at} /></span>],
  );
  if (uploader) facts.push(["Uploaded by", uploader]);
  if (source.archived_at) facts.push(["Archived", <span key="archived" className="font-mono"><DateTime iso={source.archived_at} /></span>]);
  facts.push(["Origin", source.origin === "external" ? "External (from the web)" : "Internal (uploaded)"]);
  if (source.url) facts.push(["Read from", <a key="url" href={source.url} target="_blank" rel="noreferrer" className="break-all underline">{source.url}</a>]);
  facts.push(["Type", <span key="type" className="font-mono">{source.mime_type}</span>]);
  if (source.page_count !== null) facts.push(["Pages", <span key="pages" className="font-mono">{source.page_count}</span>]);
  if (source.byte_size !== null) facts.push(["Size", <span key="size" className="font-mono">{formatBytes(source.byte_size)}</span>]);
  if (usage) {
    facts.push(
      ["Knowledge units", <Tooltip key="units" content="How many of this file's knowledge units are cited by a live article section."><span className="font-mono">{usage.usedUnits} of {usage.units}</span></Tooltip>],
      ["Articles", <span key="articles" className="font-mono">{usage.articles}</span>],
      ["Article sections", <span key="sections" className="font-mono">{usage.sections}</span>],
      ["Article lines", <span key="lines" className="font-mono">{usage.lines}</span>],
    );
  }
  if (reach) {
    facts.push(
      ["Definitions", <span key="definitions" className="font-mono">{reach.definitions.length}</span>],
      ["Entities", <span key="entities" className="font-mono">{reach.entities.length}</span>],
      ["Domains", <span key="domains" className="font-mono">{reach.domains.length}</span>],
    );
  }
  return (
    <Section title="File" actions={<SourceRowMenu source={source} />}>
      <p className="text-body font-medium">{source.title}</p>
      <Facts items={facts} />
    </Section>
  );
}

// ARTICLES: every live article with a live section built on this file's knowledge
function SourceArticles({ sourceId }: { sourceId: string }) {
  const articles = useSourceArticles(sourceId);
  const list = articles.data ?? [];
  return (
    <Section title={`Articles from this file (${list.length})`}>
      <QueryState query={articles}>
        {list.length === 0 ? <Note>No article is built on this file&apos;s knowledge yet.</Note> : null}
        <ul className="flex flex-col gap-1.5">
          {list.map((page) => (
            <li key={page.id}>
              <TextLink href={`/p/${page.slug}`}>{page.title}</TextLink>
            </li>
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}

// KNOWLEDGE: every unit whose current version cites this file, with its evidence state
function SourceKnowledge({ sourceId }: { sourceId: string }) {
  const [visibleCount, setVisibleCount] = useState(50);
  const unitIds = useSourceUnitIds(sourceId);
  const units = useUnitSummaries(unitIds.data ?? []);
  const list = (units.data ?? []).filter((unit) => !unit.retired_at);
  return (
    <Section title={`Knowledge from this file (${list.length})`}>
      <QueryState query={readsState([unitIds, units])}>
        {list.length === 0 ? <Note>No current knowledge cites this file.</Note> : null}
        <ul className="flex flex-col gap-1.5">
          {list.slice(0, visibleCount).map((unit) => (
            <li key={unit.id}>
              <UnitLink unit={unit} />
            </li>
          ))}
        </ul>
        {visibleCount < list.length ? <Button variant="outline" onClick={() => setVisibleCount((count) => count + 50)}>Show 50 more knowledge units</Button> : null}
      </QueryState>
    </Section>
  );
}

// DEFINITIONS, ENTITIES AND DOMAINS: what this file's live knowledge produced, each listed by name
function SourceReachLists({ sourceId }: { sourceId: string }) {
  const reach = useSourceReach(sourceId);
  const { definitions = [], entities = [], domains = [] } = reach.data ?? {};
  return (
    <>
      <Section title={`Definitions from this file (${definitions.length})`}>
        <QueryState query={reach}>
          {definitions.length === 0 ? <Note>No glossary definition cites this file.</Note> : null}
          <ul className="flex flex-col gap-1.5">
            {definitions.map((entry) => (
              <li key={entry.term}>
                <TextLink href={`/glossary#${glossaryAnchor(entry.term)}`}>{entry.term}</TextLink>
              </li>
            ))}
          </ul>
        </QueryState>
      </Section>
      <Section title={`Entities from this file (${entities.length})`}>
        <QueryState query={reach}>
          {entities.length === 0 ? <Note>No entity is linked to this file&apos;s knowledge.</Note> : null}
          <ul className="flex flex-col gap-1.5">
            {entities.map((entity) => (
              <li key={entity.id} className="flex items-baseline gap-2">
                <TextLink href={`/entities/${entity.id}`}>{entity.name}</TextLink>
                <span className="text-xs text-muted-foreground">{entity.type}</span>
              </li>
            ))}
          </ul>
        </QueryState>
      </Section>
      <Section title={`Domains from this file (${domains.length})`}>
        <QueryState query={reach}>
          {domains.length === 0 ? <Note>No domain holds this file&apos;s knowledge.</Note> : null}
          <ul className="flex flex-col gap-1.5">
            {domains.map((domain) => (
              <li key={domain.id}>
                <TextLink href="/domains">{domain.path}</TextLink>
              </li>
            ))}
          </ul>
        </QueryState>
      </Section>
    </>
  );
}
