"use client";

import Link from "next/link";
import { Globe, Mail, MapPin, Phone, StickyNote, UserRound } from "lucide-react";
import { type ComponentType, useState } from "react";
import { Tooltip } from "@/components/standard/tooltip";
import { allContacts, CONTACT_LABELS, type ContactKind, contactHref, initialsOf, sentenceCase, type StakeholderCard as Card, cardKind } from "@/lib/stakeholders/cards";
import { cn } from "@/lib/utils";
import type { Power } from "./power";
import { StakeholderMenu } from "./StakeholderMenu";

// A colour per kind, picked by hashing its name, so a kind keeps its colour without a fixed list
const KIND_COLORS = [
  "bg-blue-950 text-blue-100", "bg-emerald-950 text-emerald-100", "bg-amber-950 text-amber-100",
  "bg-violet-950 text-violet-100", "bg-rose-950 text-rose-100", "bg-cyan-950 text-cyan-100", "bg-lime-950 text-lime-100",
];
export function kindColor(kind: string): string {
  let hash = 0;
  for (const char of kind) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return KIND_COLORS[hash % KIND_COLORS.length]!;
}

export const CONTACT_ICONS: Record<ContactKind, ComponentType<{ className?: string }>> = {
  email: Mail, phone: Phone, website: Globe, address: MapPin, person: UserRound, other: StickyNote,
};

const FACTS_SHOWN = 3;
const FUNCTIONS_SHOWN = 3;

// ONE CARD: who it is and what kind, how it relates to us, a few facts and functions, contacts,
// and how much knowledge stands behind it. The name opens the full card.
export function StakeholderCard({ card, power, overUs }: { card: Card; power?: Power; overUs?: Power }) {
  const kind = cardKind(card);
  const contacts = allContacts(card);
  return (
    <article className={cn("relative flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-link/40", card.hidden && "opacity-60")}>
      <header className="flex items-start gap-3">
        <StakeholderBadge card={card} className="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <Link href={`/stakeholders/${card.entityId}`} className="block truncate text-body font-semibold after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none">
            {card.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn("rounded px-1.5 py-0.5 font-medium", kindColor(kind))}>{sentenceCase(kind)}</span>
            {power && <PowerBadge power={power} />}
            {overUs && <PowerBadge power={overUs} overUs />}
            {card.isOurs && <span className="rounded bg-link/15 px-1.5 py-0.5 font-medium text-link">Our organization</span>}
            {card.hidden && <span className="text-faint">Hidden</span>}
          </div>
          {card.person && (card.person.title || card.person.organization) && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{[card.person.title, card.person.organization].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="relative z-10"><StakeholderMenu card={card} /></div>
      </header>

      {/* WHO THEY ARE first (the web's overview, else the description from the knowledge), then their part in the work */}
      {(card.web?.summary || card.description) && (
        <p className="flex items-start gap-1.5 text-panel">
          {card.web && (
            <Tooltip content={`From the web: ${card.web.sources.map((source) => source.title).join(" · ")}`}>
              <span className="relative z-10 mt-1 shrink-0" aria-label="From the web"><Globe className="size-3 text-faint" /></span>
            </Tooltip>
          )}
          <span className="line-clamp-3">{card.web?.summary || card.description}</span>
        </p>
      )}

      {card.relation && (
        <div className="space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">In your work</p>
          <p className="text-xs text-muted-foreground">{card.relation}</p>
        </div>
      )}

      {card.keyFacts.length > 0 && (
        <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
          {card.keyFacts.slice(0, FACTS_SHOWN).map((fact) => (
            <div key={`${fact.label}:${fact.value}`} className="contents">
              <dt className="text-faint">{fact.label}</dt>
              <dd className="min-w-0">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.functions.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground marker:text-faint">
          {card.functions.slice(0, FUNCTIONS_SHOWN).map((fn) => <li key={fn.text}>{fn.text}</li>)}
        </ul>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-faint">
        <span>
          {card.claimCount} claim{card.claimCount === 1 ? "" : "s"} · {card.sourceCount} source{card.sourceCount === 1 ? "" : "s"}
          {card.stale && (
            <Tooltip content="Its claims changed after this card was written; the next upload or Update cards rewrites it">
              <span className="relative z-10 ml-2 inline-block size-1.5 rounded-full bg-needs-you align-middle" aria-label="Card out of date" />
            </Tooltip>
          )}
        </span>
        {contacts.length > 0 && (
          <span className="relative z-10 flex items-center gap-1">
            {contacts.slice(0, 5).map((contact) => <ContactIcon key={`${contact.kind}:${contact.value}`} contact={contact} />)}
          </span>
        )}
      </footer>
    </article>
  );
}

// A contact as an icon; its value shows on hover and it opens mail, phone or the site when it can
function ContactIcon({ contact }: { contact: ReturnType<typeof allContacts>[number] }) {
  const Icon = CONTACT_ICONS[contact.kind];
  const href = contactHref(contact);
  const text = `${contact.label ? `${contact.label}: ` : ""}${contact.value}`;
  const className = "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <Tooltip content={`${CONTACT_LABELS[contact.kind]} · ${text}`}>
      {href ? (
        <a href={href} target={contact.kind === "website" ? "_blank" : undefined} rel="noreferrer" aria-label={`${CONTACT_LABELS[contact.kind]}: ${text}`} className={className}>
          <Icon className="size-3.5" />
        </a>
      ) : (
        <span role="img" aria-label={`${CONTACT_LABELS[contact.kind]}: ${text}`} className={className}><Icon className="size-3.5" /></span>
      )}
    </Tooltip>
  );
}

// POWER 0 to 1000 (125 points per tenfold), with the reasons behind it on hover: general power,
// or (overUs) the part of it that bears on our own work
export function PowerBadge({ power, overUs, className }: { power: Power; overUs?: boolean; className?: string }) {
  const name = overUs ? "Power over our work" : "Power";
  return (
    <Tooltip content={(
      <span className="block space-y-1">
        <span className="block font-medium">{name} {power.points} of 1000{power.estimated ? " (estimate)" : ""}</span>
        {power.reasons.map((reason) => <span key={reason} className="block">{reason}</span>)}
      </span>
    )}>
      <span className={cn("relative z-10 rounded border px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground", overUs && "border-link/40 text-link", className)} aria-label={`${name} ${power.points} of 1000${power.estimated ? ", estimate" : ""}`}>
        {overUs ? "Over us" : "Power"} {power.points}{power.estimated && <span className="text-faint">~</span>}
      </span>
    </Tooltip>
  );
}

// THE CARD'S BADGE: the logo from its official website, or its initials in its kind's colour
// (also when the logo will not load)
export function StakeholderBadge({ card, className }: { card: Pick<Card, "name" | "logoUrl" | "kind" | "type">; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (card.logoUrl && !broken) {
    return (
      <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a logo from the public bucket, tiny and unoptimized on purpose */}
        <img src={card.logoUrl} alt="" loading="lazy" className="size-full object-contain" onError={() => setBroken(true)} />
      </span>
    );
  }
  return <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-md font-semibold", kindColor(cardKind(card)), className)}>{initialsOf(card.name)}</span>;
}
