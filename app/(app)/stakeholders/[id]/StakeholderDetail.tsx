"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Note, QueryState, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { formatDate } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { Tooltip } from "@/components/standard/tooltip";
import { queryKeys, useUnitEntities } from "@/lib/queries";
import type { UnitSummary } from "@/lib/queries/screens";
import { allContacts, CONTACT_LABELS, cardKind, contactHref, sentenceCase, type StakeholderCard } from "@/lib/stakeholders/cards";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CONTACT_ICONS, kindColor, StakeholderBadge } from "../StakeholderCard";
import { StakeholderMenu } from "../StakeholderMenu";
import { useUnitSummariesByIds } from "../../units/unitSummaries";
import { useStakeholderCards } from "../StakeholdersScreen";

type Detail = {
  related: { entityId: string; name: string; kind: string; shared: number }[];
  sources: { sourceId: string; title: string; claims: number }[];
};

// Related stakeholders and sources for one card
function useStakeholderDetail(entityId: string) {
  return useQuery({
    queryKey: [...queryKeys.table("entity_profiles"), "detail", entityId],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().rpc("stakeholder_detail" as never, { p_entity_id: entityId } as never);
      if (error) throw new Error(error.message);
      return data as unknown as Detail;
    },
  });
}

// Claim kinds in the order a reader wants them
const KIND_ORDER = ["fact", "decision", "procedure", "definition", "preference"];

// THE FULL CARD: who, how they relate to us, facts and functions with the claims behind them,
// contacts, related stakeholders, then every claim about them by kind and the sources
export function StakeholderDetail({ entityId }: { entityId: string }) {
  const cards = useStakeholderCards();
  // The body waits for the cards; start its reads now so they arrive together
  useStakeholderDetail(entityId);
  useUnitEntities({ filters: { entity_id: entityId } });
  const card = cards.data?.find((candidate) => candidate.entityId === entityId);
  return (
    <QueryState query={cards}>
      {card ? (
        <div className="flex flex-col gap-6">
          <Header card={card} />
          <Body card={card} />
        </div>
      ) : (
        <Note>No stakeholder card for this entity. <TextLink href={`/entities/${entityId}`}>Open the entity</TextLink></Note>
      )}
    </QueryState>
  );
}

function Header({ card }: { card: StakeholderCard }) {
  const kind = cardKind(card);
  return (
    <header className="flex items-start gap-4">
      <StakeholderBadge card={card} className="size-14 rounded-lg text-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="text-lg font-semibold">{card.name}</h2>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cn("rounded px-1.5 py-0.5 font-medium", kindColor(kind))}>{sentenceCase(kind)}</span>
          {card.isOurs && <span className="rounded bg-link/15 px-1.5 py-0.5 font-medium text-link">Our organization</span>}
          {card.aliases.length > 0 && <span className="text-faint">Also: {card.aliases.join(" · ")}</span>}
        </div>
        {card.person && (card.person.title || card.person.organization) && (
          <p className="text-panel text-muted-foreground">
            {card.person.title}{card.person.title && card.person.organization ? " · " : ""}
            {card.person.organization && (card.person.organizationEntityId
              ? <TextLink href={`/stakeholders/${card.person.organizationEntityId}`}>{card.person.organization}</TextLink>
              : card.person.organization)}
          </p>
        )}
        <p className="text-xs text-faint">
          {card.claimCount} claim{card.claimCount === 1 ? "" : "s"} · {card.sourceCount} source{card.sourceCount === 1 ? "" : "s"}
          {card.generatedAt ? ` · card written ${formatDate(card.generatedAt)}` : ""}
          {card.stale ? " · claims changed since" : ""}
        </p>
      </div>
      <StakeholderMenu card={card} />
    </header>
  );
}

function Body({ card }: { card: StakeholderCard }) {
  const links = useUnitEntities({ filters: { entity_id: card.entityId } });
  const unitIds = (links.data ?? []).map((row) => row.unit_id);
  const units = useUnitSummariesByIds(unitIds);
  const live = (units.data ?? []).filter((unit) => !unit.retired_at);
  const unitById = new Map(live.map((unit) => [unit.id, unit]));
  const detail = useStakeholderDetail(card.entityId);
  const contacts = allContacts(card);
  const byKind = KIND_ORDER.map((kind) => [kind, live.filter((unit) => unit.kind === kind)] as const).filter(([, list]) => list.length > 0);

  return (
    <>
      <OverviewSection card={card} />

      {(card.relation || card.person?.role || card.keyFacts.length > 0 || card.functions.length > 0) && (
        <Section title="In your work">
          {card.relation && <p className="max-w-prose text-body">{card.relation}</p>}
          {card.person?.role && <p className="max-w-prose text-panel"><span className="text-muted-foreground">Role </span>{card.person.role}<Citations unitIds={card.person.unitIds} units={unitById} /></p>}
        </Section>
      )}

      {card.keyFacts.length > 0 && (
        <Section title="Key facts">
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-panel">
            {card.keyFacts.map((fact) => (
              <div key={`${fact.label}:${fact.value}`} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd>{fact.value}<Citations unitIds={fact.unitIds} units={unitById} /></dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {card.functions.length > 0 && (
        <Section title="Functions">
          <ul className="list-disc space-y-1 pl-5 text-panel marker:text-faint">
            {card.functions.map((fn) => <li key={fn.text}>{fn.text}<Citations unitIds={fn.unitIds} units={unitById} /></li>)}
          </ul>
        </Section>
      )}

      <Section title="Contacts">
        {contacts.length === 0 ? <Note>No contact details in your sources yet. Add them from the menu (Edit contacts).</Note> : (
          <ul className="flex flex-col gap-2 text-panel">
            {contacts.map((contact) => {
              const Icon = CONTACT_ICONS[contact.kind];
              const href = contactHref(contact);
              return (
                <li key={`${contact.kind}:${contact.value}`} className="flex items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{contact.label ?? CONTACT_LABELS[contact.kind]}</span>
                  {href ? <a href={href} target={contact.kind === "website" ? "_blank" : undefined} rel="noreferrer" className="text-link hover:underline">{contact.value}</a> : <span>{contact.value}</span>}
                  <span className="text-xs text-faint">{contact.fromPerson ? "added by a person" : "from sources"}</span>
                  {!contact.fromPerson && contact.unitIds ? <Citations unitIds={contact.unitIds} units={unitById} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {(detail.data?.related.length ?? 0) > 0 && (
        <Section title="Related stakeholders">
          <ul className="flex flex-wrap gap-2">
            {detail.data!.related.map((other) => (
              <li key={other.entityId}>
                <Link href={`/stakeholders/${other.entityId}`} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:border-link/40">
                  <span className="font-medium">{other.name}</span>
                  <span className="text-faint">{sentenceCase(other.kind)} · {other.shared} shared</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Claims (${live.length})`}>
        <QueryState query={readsState([links, units])}>
          {live.length === 0 ? <Note>No live claims are about this stakeholder.</Note> : null}
          <div className="flex flex-col gap-4">
            {byKind.map(([kind, list]) => (
              <div key={kind} className="space-y-1.5">
                <h4 className="text-xs font-medium uppercase tracking-wide text-faint">{kindHeading(kind)} · {list.length}</h4>
                <ul className="flex flex-col gap-1.5">
                  {list.map((unit) => <li key={unit.id} className="text-panel"><UnitLink unit={unit} /></li>)}
                </ul>
              </div>
            ))}
          </div>
        </QueryState>
      </Section>

      {(detail.data?.sources.length ?? 0) > 0 && (
        <Section title="Sources">
          <ul className="flex flex-col gap-1 text-panel">
            {detail.data!.sources.map((source) => (
              <li key={source.sourceId} className="flex items-baseline justify-between gap-3">
                <TextLink href={`/sources/${source.sourceId}`}>{source.title}</TextLink>
                <span className="shrink-0 text-xs text-faint">{source.claims} claim{source.claims === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

const kindHeading = (kind: string) => ({ fact: "Facts", decision: "Decisions", procedure: "Procedures", definition: "Definitions", preference: "Preferences" })[kind] ?? kind;

// SMALL NUMBERED LINKS to the claims a fact came from; hovering shows the claim's title
function Citations({ unitIds, units }: { unitIds: string[]; units: Map<string, UnitSummary> }) {
  const cited = unitIds.flatMap((id) => (units.get(id) ? [units.get(id)!] : []));
  if (!cited.length) return null;
  return (
    <>
      {cited.map((unit, index) => (
        <sup key={unit.id} className="ml-0.5 text-xs leading-none">
          <Tooltip content={unit.label || unit.content}>
            <Link href={`/units/${unit.id}`} className="text-muted-foreground hover:text-link hover:underline">[{index + 1}]</Link>
          </Tooltip>
        </sup>
      ))}
    </>
  );
}

// OVERVIEW: who the party is as a whole. The web's sure-match profile with its links (kept apart
// from the knowledge), else the description written from the knowledge.
function OverviewSection({ card }: { card: StakeholderCard }) {
  // Which of its web pages are stored as external knowledge (a source of their own)
  const urls = card.web?.sources.map((source) => source.url) ?? [];
  const stored = useQuery({
    queryKey: [...queryKeys.table("sources"), "external-by-url", urls],
    enabled: urls.length > 0,
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().from("sources").select("id, url").eq("origin", "external").is("archived_at", null).in("url", urls);
      if (error) throw new Error(error.message);
      return data.flatMap((row) => (row.url ? [{ id: row.id, url: row.url }] : []));
    },
  });
  if (!card.web) {
    if (!card.description && !card.webCheckedAt) return null;
    return (
      <Section title="Overview">
        {card.description && <p className="max-w-prose text-body">{card.description}</p>}
        {card.webCheckedAt && <p className="text-xs text-faint">Looked up on the web on {formatDate(card.webCheckedAt)}; nothing found was sure to be this {cardKind(card)}, so nothing was kept.</p>}
      </Section>
    );
  }
  const { web } = card;
  const storedByUrl = new Map((stored.data ?? []).map((source) => [source.url, source.id]));
  const cite = (index: number | null) => {
    const source = index === null ? undefined : web.sources[index];
    return source ? (
      <sup className="ml-0.5 text-xs leading-none">
        <Tooltip content={source.title}>
          <a href={source.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-link hover:underline">[{index! + 1}]</a>
        </Tooltip>
      </sup>
    ) : null;
  };
  return (
    <Section title="Overview">
      <p className="max-w-prose text-body">{web.summary}</p>
      {web.facts.length > 0 && (
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-panel">
          {web.facts.map((fact) => (
            <div key={`${fact.label}:${fact.value}`} className="contents">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd>{fact.value}{cite(fact.sourceIndex)}</dd>
            </div>
          ))}
        </dl>
      )}
      {web.website && (
        <p className="text-panel"><span className="text-muted-foreground">Website </span><a href={web.website} target="_blank" rel="noreferrer" className="text-link hover:underline">{web.website.replace(/^https?:\/\//, "")}</a></p>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground marker:text-faint">
        {web.sources.map((source) => {
          const stored = storedByUrl.get(source.url);
          return (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{source.title}</a>
              {stored && <> · <TextLink href={`/sources/${stored}`} className="text-xs">Saved as external knowledge</TextLink></>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-faint">
        Found on the web{card.webCheckedAt ? ` on ${formatDate(card.webCheckedAt)}` : ""} and checked against your knowledge.
        {storedByUrl.size > 0 ? " A page marked saved is in your knowledge as external knowledge, with its claims marked external." : " Update cards saves its best page as external knowledge once it is approved."}
      </p>
    </Section>
  );
}
