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

// Opt-in dry run of the whole article pipeline on public facts from a Wikipedia article (ARTICLE=time-cube,
// marathon-1904 or ed-wood; Time Cube by default):
// the Planner outlines it, the Writer (with its fact-check) writes each section, and the Reviewer
// edits the finished page. Nothing touches the database: the Reviewer's reads and its save are faked
// here. ARTICLE_OUT=<dir> writes the draft, the reviewed article and the raw results there, named after the article.
// RUN_AI_ARTICLE_PIPELINE=1 ARTICLE=ed-wood ARTICLE_OUT=. node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/living-page/articlePipeline.live.test.ts

const claim = (content: string, epistemicStatus: SectionUnit["epistemicStatus"] = "established"): SectionUnit => {
  const unitId = randomUUID();
  return { unitId, revisionId: randomUUID(), content, kind: "fact", epistemicStatus };
};

const TIME_CUBE: SectionUnit[] = [
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

const MARATHON_1904: SectionUnit[] = [
  claim("The men's marathon at the 1904 Summer Olympics took place in St. Louis, Missouri, on August 30, 1904."),
  claim("The 1904 Olympic marathon course measured 24 miles 1,500 yards (40 km); the marathon distance had not yet been standardized."),
  claim("32 athletes from seven nations started the 1904 Olympic marathon, and 14 finished."),
  claim("The 1904 Olympic marathon is described as a bizarre affair because of poor organization and officiating."),
  claim("The 1904 race was the third Olympic marathon; the marathon is one of 12 athletics events held at every Summer Olympics."),
  claim("Arthur L. Newton of the United States was the only runner from the 1900 Olympic marathon to return in 1904."),
  claim("The winners of the three previous Boston Marathons, Sammy Mellor, John Lordon and Michael Spring, also ran in 1904."),
  claim("Cuba and South Africa made their first appearances in the Olympic marathon in 1904."),
  claim("Len Taunyane and Jan Mashiani, two Tswana men in St. Louis for the South African exhibit at the 1904 World's Fair, were the first black athletes to compete in the Olympics."),
  claim("Taunyane and Mashiani had served as long-distance message runners during the Second Boer War."),
  claim("The 1904 marathon started at 3:00 pm, with a temperature of about 90 °F (32 °C) at the start."),
  claim("The race began with five laps of the stadium track; the rest of the course was on dusty country roads."),
  claim("Race officials rode in vehicles ahead of and behind the runners, raising dust clouds that worsened the hot and humid conditions."),
  claim("The course was not cleared, so runners had to dodge traffic, delivery wagons, trains, trolley cars and people walking dogs."),
  claim("The only water source for the runners was a well at about the halfway mark."),
  claim("Organizer James Edward Sullivan set up no other water sources, reportedly to research \"purposeful dehydration\".", "supported"),
  claim("John Lordon, the 1903 Boston Marathon winner, was violently ill after 10 miles and retired."),
  claim("Sam Mellor led at the halfway mark but became disoriented and dropped out after 14.5 miles."),
  claim("William Garcia was found unconscious on the course with severe internal injuries caused by breathing dust from the officials' cars."),
  claim("Frederick Lorz crossed the finish line first, after about 3 hours and 13 minutes."),
  claim("Lorz had dropped out after nine miles with cramps and rode in a car before re-entering the race when the car broke down."),
  claim("Alice Roosevelt was about to award Lorz the gold medal when spectators said he had not run the whole race."),
  claim("Lorz admitted the deception and said it was a practical joke; the AAU banned him for life, a ban later reduced to six months."),
  claim("Lorz won the 1905 Boston Marathon."),
  claim("Thomas Hicks won the 1904 Olympic marathon in 3:28:53, the slowest winning time in Olympic marathon history."),
  claim("Ten miles from the finish, Hicks led by 1.5 miles, and his trainers had to stop him from lying down."),
  claim("Hicks's trainers gave him several doses of strychnine mixed with brandy and egg white, the earliest recorded use of performance-enhancing drugs in the modern Olympics."),
  claim("Hicks's support team carried him over the finish line; he lost 8 pounds during the race."),
  claim("Cuban postman Andarín Carvajal arrived at the last minute after losing his money gambling in New Orleans and ran in street clothes cut into shorts."),
  claim("Carvajal ate rotten apples from an orchard during the race, had stomach cramps, took a nap, and still finished fourth."),
  claim("Albert Corey finished second and Arthur Newton third; all three medalists ran for the United States."),
  claim("Historian Clément Genty has argued that Hicks was escorted by car and carried by officials, and that the gold medal should go to Albert Corey.", "supported"),
  claim("In 2023 the International Olympic Committee's Olympic Studies Centre declined Genty's request to review the result."),
];

const ED_WOOD: SectionUnit[] = [
  claim("Edward Davis Wood Jr. (October 10, 1924 – December 10, 1978) was an American filmmaker, actor and novelist."),
  claim("In the 1950s, Wood directed low-budget science fiction, crime and horror films that later became cult classics, including Glen or Glenda (1953), Bride of the Monster (1955) and Plan 9 from Outer Space (1957)."),
  claim("In the 1960s and 1970s, Wood moved toward sexploitation and pornographic films and wrote over 80 pulp crime and sex novels."),
  claim("Wood's films are marked by campy aesthetics, technical errors, unsophisticated special effects, poorly matched stock footage and non sequitur dialogue."),
  claim("Wood's films remained largely obscure until he was posthumously named Worst Director of All Time at the 1980 Golden Turkey Awards, which renewed interest in his work."),
  claim("Some critics, such as Will Sloan, argue that Wood was creative within the financial and technical limits he faced.", "supported"),
  claim("Rudolph Grey's biography of Wood, Nightmare of Ecstasy, was published in 1992 and adapted into Tim Burton's film Ed Wood (1994), starring Johnny Depp, which received critical acclaim."),
  claim("Wood was born in Poughkeepsie, New York; his father worked for the United States Post Office as a custodian."),
  claim("According to his second wife, Kathy O'Hara, Wood's mother dressed him in girls' clothing as a child because she had wanted a daughter.", "supported"),
  claim("Wood cross-dressed throughout his life and was attached to the feel of angora."),
  claim("As a child, Wood collected comic books and pulp magazines and loved films, especially Westerns, serials and the occult."),
  claim("Buck Jones and Bela Lugosi were among Wood's earliest childhood idols."),
  claim("On his 12th birthday in 1936, Wood received his first movie camera, a Kodak Cine Special."),
  claim("One of Wood's first pieces of footage showed the airship Hindenburg passing over Poughkeepsie hours before its crash at Lakehurst."),
  claim("Wood enlisted in the United States Marine Corps in 1942 at age 17 and was discharged as a corporal in 1946."),
  claim("Wood reportedly claimed that a Japanese soldier knocked out his front teeth in combat.", "supported"),
  claim("Wood's actual service included recovering bodies on Betio after the Battle of Tarawa and experiencing minor Japanese bombing raids."),
  claim("Navy dentists removed Wood's teeth over several months, unconnected to any combat."),
  claim("A recurring filariasis infection left Wood doing clerical work for the rest of his enlistment."),
  claim("Wood later said he feared being wounded more than being killed, because a medic might find him wearing a bra and panties under his uniform."),
  claim("In 1947, Wood moved to Hollywood, where he wrote scripts and directed television pilots, commercials and micro-budget westerns, most of which failed to sell."),
  claim("In 1948, Wood wrote, produced, directed and starred in the play The Casual Company, which opened to negative reviews."),
  claim("Wood wrote under pen names including Ann Gora, after angora, and Akdov Telmig, the name of his favorite drink, the vodka gimlet, spelled backwards."),
  claim("In 1952, Wood was introduced to Bela Lugosi by his roommate Alex Gordon."),
  claim("Lugosi's son, Bela G. Lugosi, has said Wood exploited his father's fading stardom.", "supported"),
  claim("Most associates interviewed in Nightmare of Ecstasy describe Wood and Lugosi as genuine friends, and say Wood helped Lugosi through depression and drug addiction.", "supported"),
  claim("Lugosi had become dependent on morphine, which he used to control his sciatica."),
  claim("In 1953, Wood wrote and directed Glen or Glenda, starring himself as a transvestite under the alias Daniel Davis, with Bela Lugosi as the narrator."),
  claim("Dolores Fuller, Wood's girlfriend and co-star in Glen or Glenda, was shocked to learn soon afterwards that Wood actually cross-dressed."),
  claim("Wood directed the crime film Jail Bait (1954); Herbert Rawlinson replaced Lugosi in the lead and died the day after filming his scenes."),
];

const ARTICLES: Record<string, { name: string; type: string; units: SectionUnit[] }> = {
  "time-cube": { name: "Time Cube", type: "website", units: TIME_CUBE },
  "marathon-1904": { name: "Men's marathon at the 1904 Summer Olympics", type: "event", units: MARATHON_1904 },
  "ed-wood": { name: "Ed Wood", type: "person", units: ED_WOOD },
};
const ARTICLE = process.env.ARTICLE ?? "time-cube";
const CLAIMS = ARTICLES[ARTICLE]?.units ?? [];

type Line = { lineId: string; sectionId: string; content: string; unitIds: string[] };

it.runIf(process.env.RUN_AI_ARTICLE_PIPELINE === "1")(`plans, writes and reviews the ${ARTICLE} article without saving anything`, async () => {
  const article = ARTICLES[ARTICLE];
  if (!article) throw new Error(`Unknown ARTICLE ${ARTICLE}; use one of ${Object.keys(ARTICLES).join(", ")}.`);
  const settings = tokenFactoryFromEnv(process.env, process.env.AI_SMOKE_MODEL);
  if (!settings) throw new Error("Configure NEBIUS_API_KEY for the opt-in pipeline run.");
  const knowledge: ArticleKnowledge = { entity: { id: randomUUID(), type: article.type, key: ARTICLE, name: article.name }, units: CLAIMS };
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
    page: { id: pageId, title: planned.plan.title, slug: ARTICLE },
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
    writeFileSync(join(process.env.ARTICLE_OUT, `${ARTICLE}-draft.md`), draft);
    writeFileSync(join(process.env.ARTICLE_OUT, `${ARTICLE}-reviewed.md`), reviewed);
    writeFileSync(join(process.env.ARTICLE_OUT, `${ARTICLE}-report.json`), JSON.stringify(report, null, 2));
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
