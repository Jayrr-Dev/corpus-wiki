import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalDocumentPage } from "@/components/landing/legal-page";
import { contactEmail } from "@/lib/legal/contact";
import { TERMS } from "@/lib/legal/content";
import { requireFeature } from "@/lib/flags/server";

// Draft text: kept out of search results until it is reviewed
export const metadata: Metadata = { title: "Terms of service | Corpus Wiki", description: TERMS.summary, robots: { index: false } };

// TERMS OF SERVICE (/terms): a 404 while the legal_pages flag is off
export default async function TermsPage() {
  // Per request, so the flag is read live rather than frozen at build time
  await connection();
  await requireFeature("legal_pages");
  return <LegalDocumentPage eyebrow="Terms" doc={TERMS} contactEmail={contactEmail()} />;
}
