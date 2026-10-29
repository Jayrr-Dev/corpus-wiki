import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/landing/legal-page";
import { contactEmail } from "@/lib/legal/contact";
import { TERMS } from "@/lib/legal/content";

// Draft text: kept out of search results until it is reviewed
export const metadata: Metadata = { title: "Terms of service | Corpus Wiki", description: TERMS.summary, robots: { index: false } };

// TERMS OF SERVICE (/terms)
export default function TermsPage() {
  return <LegalDocumentPage eyebrow="Terms" doc={TERMS} contactEmail={contactEmail()} />;
}
