import type { Space } from "@/lib/spaces/shared";

// =====================================================================
// PHOENIX WORLD: the synthetic Parts Unlimited data the launch video's
// stage scenes render with (after The Phoenix Project). Everything here
// is fictional: .example emails, made-up ids and dates. Plain data, no
// React, so every scene lane builds rows from the same people, files
// and ids. Scene lanes add their own files beside this one.
// =====================================================================

// FAKE IDS: the same parts always give the same UUID (FNV-1a hash, laid out as a v4 UUID),
// so a source, its units and the pages citing it agree across scenes without a shared table
export function fakeId(...parts: (string | number)[]): string {
  const text = parts.join(":");
  let hex = "";
  for (let round = 0; hex.length < 32; round++) {
    let hash = 0x811c9dc5 ^ round;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    hex += (hash >>> 0).toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// FAKE TIMESTAMPS: "2026-03-12" (+ "14:30") as an ISO string in UTC, as the database returns them
export function fakeDate(day: string, time = "09:00"): string {
  return new Date(`${day}T${time}:00.000Z`).toISOString();
}

// A fake content hash for rows that need one (sources.hash)
export function fakeHash(...parts: (string | number)[]): string {
  return (fakeId("hash", ...parts) + fakeId("hash2", ...parts)).replace(/-/g, "");
}

// THE SIGNED-IN ACCOUNT: Bill Palmer, who inherits Brent's knowledge
export const PHOENIX_ACCOUNT = {
  id: fakeId("account", "bill"),
  email: "bill@partsunlimited.example",
  name: "Bill Palmer",
  avatarUrl: null,
} as const;

// THE SPACE: one workspace, owned by Bill
export const PHOENIX_SPACE: Space = {
  id: fakeId("space", "parts-unlimited"),
  name: "Parts Unlimited",
  created_at: fakeDate("2026-01-05"),
  owner_id: PHOENIX_ACCOUNT.id,
  subtitle: "IT Operations",
  subtitle_for_name: "Parts Unlimited",
};

export type PersonKey = "bill" | "brent" | "wes" | "patty" | "erik" | "sarah" | "john" | "dick";

export type Person = {
  key: PersonKey;
  id: string;
  name: string;
  role: string;
  email: string;
  status: "active" | "left";
  // the last working day, for someone who left (YYYY-MM-DD)
  lastDay?: string;
};

function person(key: PersonKey, name: string, role: string, extra: Partial<Person> = {}): Person {
  const first = name.split(" ")[0]!.toLowerCase();
  return { key, id: fakeId("person", key), name, role, email: `${first}@partsunlimited.example`, status: "active", ...extra };
}

// THE CAST: Brent is the engineer everyone depends on; he leaves on Friday 3 April 2026
export const PEOPLE: Record<PersonKey, Person> = {
  bill: person("bill", "Bill Palmer", "VP IT Operations"),
  brent: person("brent", "Brent Geller", "Lead engineer", { status: "left", lastDay: "2026-04-03" }),
  wes: person("wes", "Wes Davis", "Director of Distributed Technology"),
  patty: person("patty", "Patty McKee", "Director of IT Service Support"),
  erik: person("erik", "Erik Reid", "Board member, advisor"),
  sarah: person("sarah", "Sarah Moulton", "SVP Retail Operations"),
  john: person("john", "John Pesche", "Chief Information Security Officer"),
  dick: person("dick", "Dick Landry", "Chief Financial Officer"),
};

export type SourceKind = "pdf" | "docx" | "video" | "image" | "markdown" | "gmail" | "slack";

export type PhoenixSource = {
  key: string;
  id: string;
  kind: SourceKind;
  title: string;
  // the day the document is about or was sent (YYYY-MM-DD)
  date: string;
  mimeType: string;
  // "internal" for uploads, "gmail" or "slack" for imported threads
  origin: "internal" | "gmail" | "slack";
  author: PersonKey;
};

const MIME: Record<SourceKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  video: "video/mp4",
  image: "image/jpeg",
  markdown: "text/markdown",
  gmail: "message/rfc822",
  slack: "application/json",
};

function source(key: string, kind: SourceKind, title: string, date: string, author: PersonKey): PhoenixSource {
  const origin = kind === "gmail" ? "gmail" : kind === "slack" ? "slack" : "internal";
  return { key, id: fakeId("source", key), kind, title, date, mimeType: MIME[kind], origin, author };
}

// THE FILES AND THREADS Brent's knowledge is rebuilt from
export const SOURCES = {
  runbook: source("runbook", "pdf", "Phoenix-Release-Runbook.pdf", "2026-03-02", "brent"),
  cabMinutes: source("cabMinutes", "docx", "CAB-Minutes-2026-03.docx", "2026-03-10", "patty"),
  handover: source("handover", "video", "brent-handover-walkthrough.mp4", "2026-04-01", "brent"),
  whiteboard: source("whiteboard", "image", "payroll-incident-whiteboard.jpg", "2026-02-18", "wes"),
  postmortem: source("postmortem", "markdown", "sev1-postmortem.md", "2026-02-20", "brent"),
  cutoverPlan: source("cutoverPlan", "pdf", "Ledgerly-Cutover-Plan.pdf", "2026-03-24", "brent"),
  launchThread: source("launchThread", "gmail", "Re: Phoenix launch date", "2026-03-16", "sarah"),
  declinesThread: source("declinesThread", "gmail", "PayCore declines during peak", "2026-03-27", "dick"),
  unplannedWork: source("unplannedWork", "docx", "Unplanned-Work-Log-Q1.docx", "2026-03-31", "patty"),
  auditFindings: source("auditFindings", "pdf", "SOX-Audit-Findings-2026.pdf", "2026-03-05", "john"),
  opsChannel: source("opsChannel", "slack", "#ops-phoenix", "2026-03-30", "wes"),
} satisfies Record<string, PhoenixSource>;

export type SourceKey = keyof typeof SOURCES;
