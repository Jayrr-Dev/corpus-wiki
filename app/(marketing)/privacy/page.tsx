import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/landing/legal-page";
import { contactEmail } from "@/lib/legal/contact";
import { PRIVACY } from "@/lib/legal/content";

// Draft text: kept out of search results until it is reviewed
export const metadata: Metadata = { title: "Privacy policy | Corpus Wiki", description: PRIVACY.summary, robots: { index: false } };

// PRIVACY POLICY (/privacy)
export default function PrivacyPage() {
  return <LegalDocumentPage eyebrow="Privacy" doc={PRIVACY} contactEmail={contactEmail()} />;
}
