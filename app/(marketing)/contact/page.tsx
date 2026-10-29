import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { ContactLink, LegalShell } from "@/components/landing/legal-page";
import { contactEmail, mailtoHref } from "@/lib/legal/contact";
import { requireFeature } from "@/lib/flags/server";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";

export const metadata: Metadata = { title: "Contact | Corpus Wiki", description: "How to reach the Corpus Wiki team.", robots: { index: false } };

// CONTACT (/contact): one mail link, no form. A 404 while the legal_pages flag
// is off, or when NEXT_PUBLIC_CONTACT_EMAIL is not set.
export default async function ContactPage() {
  // Per request, so the flag is read live rather than frozen at build time
  await connection();
  await requireFeature("legal_pages");
  const email = contactEmail();
  if (!email) notFound();
  return (
    <LegalShell eyebrow="Contact" title="Talk to us" summary="Questions, feedback, privacy or account requests." contactEmail={email}>
      <div className="mt-12 rounded-2xl border border-landing-ink/10 bg-landing-ink/[0.03] p-8">
        <a
          href={mailtoHref(email, "Corpus Wiki")}
          className={`inline-flex items-center gap-2 rounded-xl bg-landing-green px-3 py-2 text-base font-semibold text-white transition duration-300 ease-landing hover:bg-landing-green-hover active:scale-[0.98] ${FOCUS}`}
        >
          <EnvelopeSimple aria-hidden className="size-4" />
          Email us
        </a>
        <p className="mt-4 text-landing-ink/65">
          Or write to <ContactLink email={email} subject="Corpus Wiki" />.
        </p>
      </div>
      <section aria-labelledby="deletion-title" className="mt-12">
        <h2 id="deletion-title" className="text-2xl font-semibold tracking-tight">Deleting your account</h2>
        <p className="mt-4 text-landing-ink/65 text-pretty">
          Email us from the address you sign in with. We delete your account, your spaces and the files stored for them, and reply when it is done.
        </p>
      </section>
    </LegalShell>
  );
}
