import type { ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { DRAFT_NOTICE, type LegalDocument } from "@/lib/legal/content";
import { mailtoHref } from "@/lib/legal/contact";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";

// DRAFT NOTICE: stays at the top of every legal page until the text is reviewed
function DraftNotice() {
  return (
    <p role="note" className="mt-8 flex items-start gap-3 rounded-2xl border border-landing-gold/40 bg-landing-gold/10 p-4 text-sm font-semibold text-landing-gold-pale">
      <WarningCircle aria-hidden className="mt-px size-5 shrink-0 text-landing-gold" />
      {DRAFT_NOTICE}
    </p>
  );
}

// The contact address as a mail link, styled like the landing's inline links
export function ContactLink({ email, subject }: { email: string; subject?: string }) {
  return (
    <a href={mailtoHref(email, subject)} className={`rounded-md font-semibold text-landing-gold underline decoration-landing-gold/40 underline-offset-4 transition-colors duration-300 ease-landing hover:text-landing-gold-pale ${FOCUS}`}>
      {email}
    </a>
  );
}

// LEGAL PAGE SHELL: the landing nav and footer around one narrow column
export function LegalShell({ eyebrow, title, summary, contactEmail, children }: { eyebrow: string; title: string; summary: string; contactEmail: string | null; children: ReactNode }) {
  return (
    <>
      <LandingNav onHome={false} />
      <main id="main" className="px-4 pt-32 pb-24 sm:px-6">
        <article className="mx-auto max-w-[680px]">
          <p className="text-sm font-semibold text-landing-gold">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
          <p className="mt-4 text-lg text-white/60 text-pretty">{summary}</p>
          <DraftNotice />
          {children}
        </article>
      </main>
      <LandingFooter legalPages hasContact={contactEmail !== null} onHome={false} />
    </>
  );
}

// A privacy policy or terms document, section by section
export function LegalDocumentPage({ eyebrow, doc, contactEmail }: { eyebrow: string; doc: LegalDocument; contactEmail: string | null }) {
  return (
    <LegalShell eyebrow={eyebrow} title={doc.title} summary={doc.summary} contactEmail={contactEmail}>
      <div className="mt-12 flex flex-col gap-12">
        {/* Without a contact address the contact section has nothing to offer, so it is left out */}
        {doc.sections.filter(section => !section.contact || contactEmail).map(section => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24">
            <h2 id={`${section.id}-title`} className="text-2xl font-semibold tracking-tight text-balance">{section.title}</h2>
            {section.paragraphs?.map(p => (
              <p key={p} className="mt-4 text-white/65 text-pretty">{p}</p>
            ))}
            {section.items && (
              <ul className="mt-4 flex flex-col gap-3">
                {section.items.map(item => (
                  <li key={item} className="flex gap-3 text-white/65 text-pretty">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-landing-gold" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
            {section.contact && contactEmail && (
              <p className="mt-4 text-white/65">
                Email <ContactLink email={contactEmail} subject={doc.title} />.
              </p>
            )}
          </section>
        ))}
      </div>
    </LegalShell>
  );
}
