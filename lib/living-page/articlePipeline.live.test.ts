import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import type { DbRpc } from "@/lib/db/rpc";
import { articleSections, type ArticleKnowledge } from "./articlePlan";
import { planArticle } from "./articlePlanner";
import type { PageReviewSnapshot } from "./pageReview";
import { runPageReview } from "./runPageReview";
import type { SectionUnit } from "./types";
import { TokenFactorySectionWriter } from "./writers/tokenFactory";

// Opt-in dry run of the whole article pipeline on public facts from Wikipedia's "Time Cube" article:
// the Planner outlines it, the Writer (with its fact-check) writes each section, and the Reviewer
// edits the finished page. Nothing touches the database: the Reviewer's reads and its save are faked
// here. ARTICLE_OUT=<dir> writes the draft, the reviewed article and the raw results there.
// RUN_AI_ARTICLE_PIPELINE=1 ARTICLE_OUT=. node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/living-page/articlePipeline.live.test.ts

const claim = (content: string, epistemicStatus: SectionUnit["epistemicStatus"] = "established"): SectionUnit => {
  const unitId = randomUUID();
  return { unitId, revisionId: randomUUID(), content, kind: "fact", epistemicStatus };
};

const CLAIMS: SectionUnit[] = [
  claim("Time Cube was a personal web page that Otis Eugene \"Gene\" Ray set up in 1997."),
  claim("Time Cube is described as pseudoscientific."),
  claim("The Time Cube website was a self-published outlet for Ray's \"theory of everything\", which he also called Time Cube."),
  claim("Ray's Time Cube theory holds that each day consists of four days occurring simultaneously."),
  claim("Ray described himself as the \"wisest man on earth\"."),
  claim("Ray described himself as a godlike being with superior intelligence who had absolute evidence and proof for his views."),
  claim("Ray asserted that the academic world had not taken Time Cube seriously."),
  claim("Ray asserted that all modern sciences take part in a worldwide conspiracy to omit his theory."),
  claim("Gene Ray died in March 2015."),
  claim("The Time Cube website's domain registration expired in August 2015."),
  claim("The Wayback Machine last archived the Time Cube website in January 2016."),
  claim("The Time Cube website had no navigation structure such as a menu or a central home page; it was one long continuous page."),
  claim("The Time Cube website uses a large amount of self-invented jargon, much of it never defined."),
  claim("On the website, Ray wrote that a psychiatrist examining his behavior would judge him schizophrenic because of the psychiatrist's narrow academic knowledge."),
  claim("Adi Robertson of The Verge described Ray's theory of time as \"an incredibly confusing one peppered with racism and homophobia\"."),
  claim("Ray's model of reality states that all of modern physics and education is wrong."),
  claim("Ray argued that Greenwich Time is a global conspiracy."),
  claim("Ray used graphs, along with pictures of himself, to argue that four moments (sunup, midday, sundown and midnight) are experienced separately and simultaneously as the Earth rotates, making up four days."),
  claim("Ray wrote that a single rotation of the Earth creates 16 corners, 96 hours and four simultaneous 24-hour days."),
  claim("Sources differ on the reward Ray offered to anyone who could prove his views wrong: one gives $1,000 and another $10,000."),
  claim("Ray spoke about Time Cube at the Massachusetts Institute of Technology in January 2002, at a student-organized event during the Independent Activities Period."),
  claim("At the MIT event, Ray repeated his $10,000 offer for professors to disprove his ideas; none attempted it."),
  claim("John C. Dvorak wrote in PC Magazine that metasites tracking crackpot websites often call Time Cube the number one nutty site."),
  claim("Dvorak characterized the Time Cube website's content as \"endless blather\"."),
  claim("Asked by Martin Sargent in 2003 how it felt to be an Internet celebrity, Ray said it was not a position he wanted but something he had to do, because no writer or speaker understands the Time Cube."),
  claim("Ray spoke about Time Cube at the Georgia Institute of Technology in April 2005, in a speech attacking the instruction offered by academics."),
  claim("In 2005, Brett Hanover made Above God, a short documentary film about Ray and Time Cube."),
  claim("Above God was likely named after one of Ray's websites, which criticized the idea that God exists."),
  claim("Above God won Best Documentary awards at the Indie Memphis Film Festival and the Atlanta Underground Film Festival."),
];

type Line = { lineId: string; sectionId: string; content: string; unitIds: string[] };

it.runIf(process.env.RUN_AI_ARTICLE_PIPELINE === "1")("plans, writes and reviews a Time Cube article without saving anything", async () => {
  const settings = tokenFactoryFromEnv(process.env, process.env.AI_SMOKE_MODEL);
  if (!settings) throw new Error("Configure NEBIUS_API_KEY for the opt-in pipeline run.");
  const knowledge: ArticleKnowledge = { entity: { id: randomUUID(), type: "website", key: "time-cube", name: "Time Cube" }, units: CLAIMS };
  const unitOf = new Map(CLAIMS.map((unit) => [unit.unitId, unit]));
  const usage = { planner: 0, writer: 0, reviewer: 0 };

  // PLANNER: title and outline
  const planned = await planArticle(settings, knowledge);
  usage.planner = (planned.tokensIn ?? 0) + (planned.tokensOut ?? 0);
  const outline = articleSections(planned.plan, knowledge).map((section) => ({ id: randomUUID(), title: section.title, unitIds: section.query.unitIds ?? [] }));

  // WRITER: each section from its own claims, with the fact-check
  const writer = new TokenFactorySectionWriter(settings);
  const dropped: unknown[] = [];
  const warn = console.warn;
  console.warn = (message: unknown, detail?: unknown) => { if (typeof message === "string" && message.startsWith("Writer line dropped")) dropped.push(detail); else warn(message, detail); };
  const lines: Line[] = [];
  try {
    for (const section of outline) {
      // The sections written so far, as read_page_context gives them during a page build
      const pageContext = outline.flatMap((other) => {
        const text = lines.filter((line) => line.sectionId === other.id).map((line) => line.content).join("\n\n");
        return other.id !== section.id && text ? [{ section: other.title, text }] : [];
      });
      const revision = await writer.reviseSection({ pageTitle: planned.plan.title, sectionTitle: section.title, lines: [], units: section.unitIds.map((id) => unitOf.get(id)!), uncoveredUnitIds: section.unitIds, pageContext });
      usage.writer += (revision.tokensIn ?? 0) + (revision.tokensOut ?? 0);
      lines.push(...revision.add.map((line) => ({ lineId: randomUUID(), sectionId: section.id, content: line.text, unitIds: line.unitIds })));
    }
  } finally {
    console.warn = warn;
  }
  const draft = render(planned.plan.title, outline, lines);

  // REVIEWER: the page review, reading this snapshot and saving nowhere
  const pageId = randomUUID();
  const snapshot = {
    page: { id: pageId, title: planned.plan.title, slug: "time-cube" },
    sections: outline.map((section) => ({ id: section.id, title: section.title, mode: "generated" })),
    lines: lines.map((line) => ({ content: line.content, line_id: line.lineId, section_id: line.sectionId, author: "ai", unit_revision_ids: line.unitIds.map((id) => unitOf.get(id)!.revisionId) })),
    pages: [{ id: pageId, title: planned.plan.title }],
    // The cited claims' current revisions, as page_review_snapshot sends them
    claims: CLAIMS.filter((unit) => lines.some((line) => line.unitIds.includes(unit.unitId))).map((unit) => ({ id: unit.revisionId, unit_id: unit.unitId, content: unit.content })),
  } as PageReviewSnapshot;
  type SavedEdit = { type: string; targetId: string; text: string; reason: string; unitRevisionIds?: string[] };
  let saved: { p_edits: SavedEdit[]; p_review: { summary: string; edits: SavedEdit[]; findings: unknown[] }; p_trace: { tokensIn: number | null; tokensOut: number | null } } | undefined;
  const db = { call: async (name: string, args: Record<string, unknown>) => {
    if (name === "page_review_snapshot") return snapshot;
    if (name !== "complete_page_review") throw new Error(`Unexpected database call in a dry run: ${name}`);
    saved = args as typeof saved;
    return { summary: "Dry run", edits: saved!.p_edits.length, exceptions: 0, changeSetId: null };
  } } as DbRpc;
  const droppedEdits: unknown[] = [];
  console.warn = (message: unknown, detail?: unknown) => { if (typeof message === "string" && message.startsWith("Reviewer edit dropped")) droppedEdits.push({ why: message, ...(detail as object) }); else warn(message, detail); };
  try {
    await runPageReview(db, settings, pageId, null);
  } finally {
    console.warn = warn;
  }
  const review = saved!.p_review;
  usage.reviewer = (saved!.p_trace.tokensIn ?? 0) + (saved!.p_trace.tokensOut ?? 0);

  // The reviewed article: the saved line rewrites (with their citations), removals and heading renames applied
  const savedEdits = saved!.p_edits;
  const unitOfRevision = new Map(CLAIMS.map((unit) => [unit.revisionId, unit.unitId]));
  const removed = new Set(savedEdits.filter((item) => item.type === "retire_line").map((item) => item.targetId));
  const reviewedLines = lines.filter((line) => !removed.has(line.lineId)).map((line) => {
    const edit = savedEdits.find((item) => item.type === "revise_line" && item.targetId === line.lineId);
    return edit ? { ...line, content: edit.text, unitIds: edit.unitRevisionIds?.map((id) => unitOfRevision.get(id)!) ?? line.unitIds } : line;
  });
  const reviewedOutline = outline.map((section) => {
    const edit = savedEdits.find((item) => item.type === "rename_section" && item.targetId === section.id);
    return edit ? { ...section, title: edit.text } : section;
  });
  const reviewed = render(planned.plan.title, reviewedOutline, reviewedLines);

  const covered = new Set(lines.flatMap((line) => line.unitIds));
  const report = {
    model: settings.model, title: planned.plan.title, usage, dropped,
    outline: outline.map((section) => ({ title: section.title, claims: section.unitIds.map((id) => CLAIMS.indexOf(unitOf.get(id)!) + 1) })),
    uncovered: CLAIMS.flatMap((unit, index) => (covered.has(unit.unitId) ? [] : [index + 1])),
    review: {
      summary: review.summary, proposed: review.edits.length, droppedEdits, findings: review.findings,
      saved: savedEdits.map((edit) => {
        const line = lines.find((item) => item.lineId === edit.targetId);
        const number = (unitId: string) => CLAIMS.indexOf(unitOf.get(unitId)!) + 1;
        return { type: edit.type, before: line?.content ?? outline.find((section) => section.id === edit.targetId)?.title, text: edit.text, reason: edit.reason,
          ...(line && edit.type === "revise_line" ? { citesBefore: line.unitIds.map(number), citesAfter: (edit.unitRevisionIds?.map((id) => unitOfRevision.get(id)!) ?? line.unitIds).map(number) } : {}) };
      }),
    },
  };
  console.info("ARTICLE PIPELINE", JSON.stringify(report, null, 2), `\n\n${reviewed}`);
  if (process.env.ARTICLE_OUT) {
    writeFileSync(join(process.env.ARTICLE_OUT, "time-cube-draft.md"), draft);
    writeFileSync(join(process.env.ARTICLE_OUT, "time-cube-reviewed.md"), reviewed);
    writeFileSync(join(process.env.ARTICLE_OUT, "time-cube-report.json"), JSON.stringify(report, null, 2));
  }
  expect(lines.length).toBeGreaterThan(0);
}, 900_000);

// The article as Markdown: title, then each section's lines as paragraphs
function render(title: string, outline: { id: string; title: string }[], lines: Line[]): string {
  return [`# ${title}`, ...outline.flatMap((section) => {
    const body = lines.filter((line) => line.sectionId === section.id).map((line) => line.content);
    return [section.title === "Overview" ? "" : `## ${section.title}`, ...body].filter(Boolean);
  })].join("\n\n") + "\n";
}
