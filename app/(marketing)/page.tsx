import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand/BrandMark";
import {
  AgentsVisual, BookVisual, ClientVisual, DocsVisual, LifeVisual, MergeVisual, ReviewVisual, SourceVisual, UndoVisual,
} from "@/components/landing/card-visuals";
import { DemoEmbed } from "@/components/landing/demo-embed";
import { LandingNav } from "@/components/landing/landing-nav";
import { PlaceholderTag } from "@/components/landing/product-mocks";
import { Reveal } from "@/components/landing/reveal";
import { TaglineReveal } from "@/components/landing/tagline-reveal";

// =====================================================================
// LANDING PAGE (/): one offer, one audience, one action.
// Built to the landing-page-design skill: Geist only, Tailwind scale sizes,
// spacing from the 2 to 96px set, flat backgrounds, Phosphor icons.
// Anything marked with <PlaceholderTag> needs real content before launch.
// =====================================================================

const EASE = "ease-landing";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";
// HEADLINES: one system for the whole page. Bold, tight, line height 1;
// 60px hero and 48px sections on desktop, 36px and 32px on phones.
// A highlighted word gets the palette-underline, never a second text colour.
const H1 = "text-4xl font-bold leading-none tracking-headline text-balance sm:text-6xl";
const H2 = "text-headline font-bold leading-none tracking-headline text-balance sm:text-5xl";

// PRIMARY ACTION: the same button opens and closes the page
function StartButton() {
  return (
    <Link
      href="/signup"
      className={`group inline-flex items-center gap-2 rounded-xl bg-landing-green px-3 py-2 text-base font-semibold text-white transition duration-300 hover:bg-landing-green-hover active:scale-[0.98] ${EASE} ${FOCUS}`}
    >
      Start free
      <ArrowRight className={`size-4 transition-transform duration-300 group-hover:translate-x-0.5 ${EASE}`} />
    </Link>
  );
}

// Hidden: the one-term glossary demo (concept 8) repeats the glossary entry
// demo (concept 9). Kept so it can come back by flipping this flag.
const SHOW_TERM_DEMO = false;

// TRUST: what keeps people in charge; the difference from other AI tools
const TRUST = [
  { visual: SourceVisual, title: "Every line has a source", body: "Every sentence links to the file and the page it came from." },
  { visual: ReviewVisual, title: "Risky changes wait for you", body: "Safe updates apply on their own. Conflicts and deletions wait for a person." },
  { visual: UndoVisual, title: "Undo anything", body: "Every change is recorded with its cause and can be reversed." },
  { visual: MergeVisual, title: "One answer, not ten versions", body: "Matching facts merge into one, and every source stays attached." },
];

const USE_CASES = [
  { visual: DocsVisual, title: "Self-maintaining docs", body: "Handbooks, policies and project pages that update when a new file changes the rules." },
  { visual: LifeVisual, title: "Your life's wiki", body: "Notes, chats, lectures, plans, workouts and friends, sorted into one wiki about you." },
  { visual: ClientVisual, title: "Client tracking", body: "Every client's details, deal stage and last talk, kept current from emails and calls." },
  { visual: BookVisual, title: "Learning a big subject", body: "Long books become linked, sourced pages in minutes." },
  { visual: AgentsVisual, title: "Memory for AI agents", body: "One sourced memory your AI tools read and write over MCP." },
];

const FAQ: { q: string; a: string; placeholder?: boolean }[] = [
  { q: "What files can I upload?", a: "PDF, Word and Markdown files. Each one is kept as evidence, so you can always open the original." },
  { q: "What is a claim?", a: "One fact, rule or decision taken from a document, small enough to stand on its own. Every claim keeps a link to the page it came from." },
  { q: "What happens when I upload a newer version?", a: "Corpus Wiki compares it with what it already knows and drafts changes to the claims it affects. Safe changes apply in one step. Others wait for a person. Only the lines that changed are rewritten." },
  { q: "Can the AI change my wiki without me knowing?", a: "No. Every change is recorded with its cause, and old versions are never overwritten. You can see what changed, why, and which document triggered it." },
  { q: "What if two documents disagree?", a: "The conflict stays visible. Both claims stay linked to their sources until someone decides which one holds." },
  { q: "Can I share the wiki outside my team?", a: "Yes. You can publish a read only version of a space and share the link or embed it on your site." },
  { q: "How much does it cost?", a: "Pricing and plan limits still need to be written.", placeholder: true },
  { q: "Where is my data stored?", a: "Storage location, encryption and retention details still need to be written.", placeholder: true },
];

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.filter(f => !f.placeholder).map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
};

function SectionHeading({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-[680px] text-center">
      {eyebrow && <p className="text-sm font-semibold text-landing-gold">{eyebrow}</p>}
      <h2 className={`mt-3 ${H2}`}>{title}</h2>
      {body && <p className="mt-4 text-lg text-white/60 text-pretty">{body}</p>}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <>
      <LandingNav />
      <main id="main">
        {/* HERO: the glass machine under the outcome headline and the one action */}
        <section className="relative isolate flex min-h-svh flex-col justify-center overflow-hidden px-4 pt-28 pb-12 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-10 text-center">
            <Reveal className="flex flex-col items-center">
              <h1 className={`max-w-[900px] uppercase ${H1}`}>
                Your automated <br className="hidden sm:inline" />
                <span className="palette-underline">knowledge base</span>
              </h1>
              <p className="mt-10 max-w-[680px] text-lg text-white/70 text-pretty sm:text-xl">
                Add your files. Corpus Wiki sorts them out, writes simple pages for your team and keeps them up to date.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <StartButton />
                <span className="text-sm text-white/50">Free to start</span>
                <PlaceholderTag>Confirm free plan terms</PlaceholderTag>
              </div>
            </Reveal>
            <Reveal delay={150} className="w-full">
              <DemoEmbed concept={6} title="Files feed a graph that organizes itself and produces pages, a glossary and more" minHeight={460} />
            </Reveal>
            <Reveal delay={300}>
              {/* BUILT WITH: the models and the platform behind the app. NVIDIA's
                  brand rules allow its logo only with written approval, so Nemotron is text. */}
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 text-sm text-white/60">
                <span>Built with <span className="font-semibold text-white">NVIDIA Nemotron</span></span>
                <span aria-hidden className="text-white/25">·</span>
                <span className="inline-flex items-center gap-3">
                  Powered by
                  <Image src="/brand/nebius/nebius-outline-white.svg" alt="Nebius" width={87} height={24} unoptimized className="h-6 w-auto" />
                  <span className="rounded-md border border-landing-nebius px-2 py-0.5 text-xs font-semibold tracking-wider text-landing-nebius uppercase">Token Factory</span>
                </span>
              </p>
            </Reveal>
          </div>
        </section>

        {/* USE CASES */}
        <section id="product" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Use cases" title="For knowledge that keeps changing" />
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {USE_CASES.map((b, i) => (
              <Reveal key={b.title} delay={i * 80}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-transform duration-500 hover:-translate-y-1 ease-landing">
                  <b.visual />
                  <h3 className="mt-5 px-2 text-base font-semibold">{b.title}</h3>
                  <p className="mt-2 px-2 pb-2 text-sm text-white/60 text-pretty">{b.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* TAGLINE REVEAL: the core promise, word by word */}
        <section aria-label="What Corpus Wiki promises" className="px-4 py-24 sm:px-6">
          <TaglineReveal
            lines={["Maintaining, updating and organizing knowledge is HARD.", { text: "So, we do it for you.", className: "text-landing-go" }]}
            marks={{ HARD: "text-landing-red" }}
          />
        </section>

        {/* HOW IT WORKS, STEP 1: a long PDF with pictures turned into short, sourced facts */}
        <section id="how" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="How it works" title="From long PDFs to clear facts." body="Every page is read, pictures included. Each fact comes out short, with its source." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={13} title="A long PDF with a diagram and a table turned into seven short, sourced knowledge units" minHeight={560} />
          </Reveal>
        </section>

        {/* HOW IT WORKS, STEP 2: the live page, sentences rewriting as sources arrive */}
        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[5fr_6fr]">
            <Reveal>
              <p className="text-sm font-semibold text-landing-gold">Self-maintaining</p>
              {/* a size down beside the demo, so the longer headline keeps to two lines */}
              <h2 className={`mt-3 max-w-[680px] ${H2} lg:text-3xl xl:text-4xl`}>We turn knowledge into pages that rewrite themselves.</h2>
              <p className="mt-4 max-w-[680px] text-lg text-white/65 text-pretty sm:text-xl">A new file arrives. Only the sentences it changes are rewritten, each with its source.</p>
            </Reveal>
            <Reveal delay={150}>
              <DemoEmbed concept={7} title="A wiki page rewriting itself as new sources arrive" minHeight={640} />
            </Reveal>
          </div>
        </section>

        {/* MULTI-MODAL: one set of sourced facts made into pages, videos, quizzes, slides and more */}
        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Multi-modal" title="Transform your knowledge into any type of resource." body="The same sourced facts become wiki pages, videos, quizzes, slides, podcasts and agent context." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={14} title="Eight knowledge units turned into a wiki page, a video, a quiz, slides, a podcast, a glossary entry, a diagram and agent context" minHeight={560} />
          </Reveal>
        </section>

        {/* TRUST AND CONTROL */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="You stay in charge" title="Knowledge you can trust and check" />
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((b, i) => (
              <Reveal key={b.title} delay={i * 80}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-transform duration-500 hover:-translate-y-1 ease-landing">
                  <b.visual />
                  <h3 className="mt-5 px-2 text-lg font-semibold">{b.title}</h3>
                  <p className="mt-2 px-2 pb-2 text-sm text-white/60 text-pretty">{b.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* FOR AI AGENTS */}
        <section id="agents" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="For AI agents" title="One memory for every agent." body="Connect your AI tools through MCP. They read sourced, current facts and remember what you teach them, across every session." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={10} title="AI agents sharing one sourced memory over MCP" minHeight={620} />
          </Reveal>
        </section>

        {/* FOR BUILDERS */}
        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="For builders" title="Just build. Docs write themselves." body="While you work with your coding agent, every feature, endpoint and decision is documented in the background." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={11} title="A week of coding while the docs fill in by themselves" minHeight={680} />
          </Reveal>
        </section>

        {/* WHAT YOU GET: glossary, stakeholders */}
        {SHOW_TERM_DEMO && (
          <section className="scroll-mt-24 px-4 py-24 sm:px-6">
            <Reveal>
              <SectionHeading eyebrow="Glossary" title="One meaning for every term." body="Definitions update as your sources change. Duplicates merge, and new terms define themselves." />
            </Reveal>
            <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
              <DemoEmbed concept={8} title="A glossary that updates, merges duplicates and adds new terms" minHeight={620} />
            </Reveal>
          </section>
        )}

        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Glossary" title="Your team&apos;s glossary, written by your files." body="Every term your documents use, defined in plain words, with real examples from your sources." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={9} title="A glossary entry gaining meanings and examples from new sources" minHeight={620} />
          </Reveal>
        </section>

        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Stakeholders" title="Know who matters, and why." body="Every person and organization in your files, how they connect and how much say they have. Kept current." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={12} title="A stakeholder map that rewires as new sources arrive" minHeight={560} />
          </Reveal>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading title="Questions" />
          </Reveal>
          <Reveal className="mx-auto mt-12 flex max-w-3xl flex-col gap-2">
            {FAQ.map(f => (
              <details key={f.q} className="group rounded-2xl border border-white/10 bg-white/[0.03]">
                <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-6 text-left font-semibold transition-colors duration-300 hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden ${FOCUS}`}>
                  <span className="text-balance">{f.q}</span>
                  <Plus className={`size-5 shrink-0 text-landing-gold transition-transform duration-500 group-open:rotate-45 ${EASE}`} />
                </summary>
                <div className="flex flex-col items-start gap-3 px-6 pb-6 text-white/60 text-pretty">
                  {f.placeholder && <PlaceholderTag />}
                  <p>{f.a}</p>
                </div>
              </details>
            ))}
          </Reveal>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }} />
        </section>

        {/* FINAL ACTION: identical to the hero, with the risk reversal */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal className="mx-auto flex max-w-[680px] flex-col items-center text-center">
            <h2 className={H2}>Give your business a living source of truth.</h2>
            <div className="mt-8">
              <StartButton />
            </div>
            <p className="mt-4 text-sm text-white/50">Connected claims. Traceable sources. Current knowledge.</p>
            <div className="mt-3">
              <PlaceholderTag>Add risk reversal: free plan, no card, cancel anytime</PlaceholderTag>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="px-4 py-12 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-white">
            <BrandMark className="size-6 text-landing-green-light" />
            <span className="font-brand text-xl">Corpus Wiki</span>
          </span>
          <ul className="flex flex-wrap items-center gap-6 text-sm text-white/60">
            <li><a href="#product" className={`rounded-md transition-colors duration-300 hover:text-white ${FOCUS}`}>Product</a></li>
            <li><a href="#how" className={`rounded-md transition-colors duration-300 hover:text-white ${FOCUS}`}>How it works</a></li>
            <li><a href="#faq" className={`rounded-md transition-colors duration-300 hover:text-white ${FOCUS}`}>Questions</a></li>
            {/* No pages yet: shown disabled rather than linking nowhere */}
            {["Privacy", "Terms", "Contact"].map(label => (
              <li key={label}>
                <span aria-disabled className="cursor-not-allowed text-white/30">{label} (placeholder)</span>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </>
  );
}
