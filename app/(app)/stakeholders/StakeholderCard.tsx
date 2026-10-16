"use client";

import Link from "next/link";
import { Globe, Mail, MapPin, Phone, StickyNote, UserRound } from "lucide-react";
import type { ComponentType } from "react";
import { Tooltip } from "@/components/standard/tooltip";
import { allContacts, CONTACT_LABELS, type ContactKind, contactHref, initialsOf, sentenceCase, type StakeholderCard as Card, cardKind } from "@/lib/stakeholders/cards";
import { cn } from "@/lib/utils";
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
export function StakeholderCard({ card }: { card: Card }) {
  const kind = cardKind(card);
  const contacts = allContacts(card);
  return (
    <article className={cn("relative flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-link/40", card.hidden && "opacity-60")}>
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold", kindColor(kind))}>{initialsOf(card.name)}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/stakeholders/${card.entityId}`} className="block truncate text-body font-semibold after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none">
            {card.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn("rounded px-1.5 py-0.5 font-medium", kindColor(kind))}>{sentenceCase(kind)}</span>
            {card.isOurs && <span className="rounded bg-link/15 px-1.5 py-0.5 font-medium text-link">Our organization</span>}
            {card.hidden && <span className="text-faint">Hidden</span>}
          </div>
        </div>
        <div className="relative z-10"><StakeholderMenu card={card} /></div>
      </header>

      {card.relation && <p className="text-panel text-muted-foreground">{card.relation}</p>}

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
