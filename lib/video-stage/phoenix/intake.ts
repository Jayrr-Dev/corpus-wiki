import type { Reference } from "@/lib/chatbot/types";
import { fakeDate, fakeId, PEOPLE, SOURCES, type PhoenixSource, type SourceKey } from "./core";

// =====================================================================
// INTAKE DATA: what the Upload and Ask scenes show. Upload: the files
// that land on the drop zone (with the time each one drops, matched to
// the voice line) and the two Gmail threads an import brings in. Ask:
// the question, the streamed answer and the sources it cites.
// =====================================================================

export type IntakeUpload = {
  key: SourceKey;
  source: PhoenixSource;
  // what the flying file card calls the kind of file
  label: string;
  size: string;
  // seconds from the scene's start
  dropAt: number;
  // processing runs from dropAt until appliedAt
  appliedAt: number;
  uploadedAt: string;
};

function upload(key: SourceKey, label: string, size: string, dropAt: number, minute: string): IntakeUpload {
  return { key, source: SOURCES[key], label, size, dropAt, appliedAt: dropAt + 1.5, uploadedAt: fakeDate("2026-04-06", minute) };
}

// THE FILES, one per word of the voice line: "PDFs, Word docs, notes, screenshots… even videos"
export const UPLOAD_FILES: IntakeUpload[] = [
  upload("runbook", "PDF", "2.4 MB", 1.2, "09:12"),
  upload("cabMinutes", "Word", "318 KB", 1.9, "09:12"),
  upload("postmortem", "Notes", "14 KB", 2.6, "09:13"),
  upload("whiteboard", "Image", "1.8 MB", 3.3, "09:13"),
  upload("handover", "Video", "412 MB", 4.3, "09:14"),
];

// THE GMAIL IMPORT: the account, its labels and the two threads it brings in
export const GMAIL_ACCOUNT = PEOPLE.bill.email;
export const GMAIL_LABELS = [
  { id: "Label_phoenix", name: "Phoenix" },
  { id: "Label_payments", name: "Payments" },
  { id: "Label_cab", name: "CAB" },
  { id: "INBOX", name: "Inbox" },
];
export const GMAIL_SELECTED = ["Label_phoenix", "Label_payments"];
// in the browser's own zone, as GmailImport formats it in local time
export const GMAIL_LAST_IMPORT = new Date(2026, 3, 2, 17, 40).toISOString();

export const GMAIL_THREADS: IntakeUpload[] = [
  { key: "launchThread", source: SOURCES.launchThread, label: "Gmail", size: "6 messages", dropAt: 6.25, appliedAt: 7.6, uploadedAt: fakeDate("2026-04-06", "09:15") },
  { key: "declinesThread", source: SOURCES.declinesThread, label: "Gmail", size: "9 messages", dropAt: 6.4, appliedAt: 7.8, uploadedAt: fakeDate("2026-04-06", "09:15") },
];

// Upload rows the table already had before the scene (the older history under the new rows)
export const EARLIER_UPLOADS: IntakeUpload[] = [
  { key: "auditFindings", source: SOURCES.auditFindings, label: "PDF", size: "1.1 MB", dropAt: -10, appliedAt: -9, uploadedAt: fakeDate("2026-04-03", "16:20") },
];

export const uploadEventId = (key: SourceKey) => fakeId("upload-event", key);

// ---------------------------------------------------------------------
// ASK
// ---------------------------------------------------------------------

export const ASK_QUESTION = "Why did we switch payment providers?";

// The cited sources, in the order the answer first cites them ([S1], [S2], [S3])
export const ASK_REFERENCES: Reference[] = [
  { id: "S1", title: SOURCES.declinesThread.title, href: `/sources/${SOURCES.declinesThread.id}`, kind: "Source", text: "Card declines during the Phoenix launch peak." },
  { id: "S2", title: SOURCES.cutoverPlan.title, href: `/sources/${SOURCES.cutoverPlan.id}`, kind: "Source", text: "Cutover from PayCore to Ledgerly, owner Brent Geller." },
  { id: "S3", title: SOURCES.handover.title, href: `/sources/${SOURCES.handover.id}`, kind: "Source", text: "Brent walks through the finished Ledgerly cutover." },
];

// THE ANSWER as the chatbot streams it: markdown with [S1]-style citations the Answer markup turns into chips
export const ASK_ANSWER = [
  "We moved from **PayCore** to **Ledgerly** because PayCore kept declining cards during the Phoenix launch peak, and customers could not check out [S1].",
  `${PEOPLE.brent.name} led the cutover and finished it on 28 March [S2]. ${PEOPLE.dick.name} signed off for finance before the switch [S1].`,
  "Brent recorded how the new setup works in his handover walkthrough before he left [S3].",
].join("\n\n");

// Earlier chats in the history list (the new one goes on top)
export const ASK_HISTORY = [
  { id: fakeId("chat", "cab"), title: "What does the CAB check before a release?", updatedAt: Date.parse(fakeDate("2026-04-03", "15:02")), messages: [] },
  { id: fakeId("chat", "sev1"), title: "Summarize the payroll Sev 1", updatedAt: Date.parse(fakeDate("2026-04-02", "11:40")), messages: [] },
  { id: fakeId("chat", "brent"), title: "What did Brent own?", updatedAt: Date.parse(fakeDate("2026-04-01", "10:15")), messages: [] },
];
export const ASK_CHAT_ID = fakeId("chat", "payments");
