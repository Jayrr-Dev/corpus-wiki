import Link from "next/link";
import {
  ArrowCounterClockwise, ArrowRight, ArrowsClockwise, BookOpenText, Brain, ClipboardText,
  LinkSimple, Plus, ShieldCheck, Stack,
} from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand/BrandMark";
import { DemoEmbed } from "@/components/landing/demo-embed";
import { LandingNav } from "@/components/landing/landing-nav";
import { PlaceholderTag } from "@/components/landing/product-mocks";
import { Reveal } from "@/components/landing/reveal";
import { TaglineReveal } from "@/components/landing/tagline-reveal";
import { pricingFaqAnswer } from "@/lib/billing/plans";
import { isFeatureEnabled } from "@/lib/flags/server";

// =====================================================================
// LANDING PAGE (/): one offer, one audience, one action.
// Built to the landing-page-design skill: Geist only, Tailwind scale sizes,
// spacing from the 2 to 96px set, flat backgrounds, Phosphor icons.
// Anything marked with <PlaceholderTag> needs real content before launch.
// The price answer and "No card needed" show only with the billing flag on;
// the page is rebuilt every minute so a flag change shows within a minute.
// =====================================================================

export const revalidate = 60;

const EASE = "ease-landing";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";

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

const PROBLEMS = [
  "A policy changes in a PDF. The wiki page that quotes it stays the same.",
  "Three teams keep three versions of the same answer.",
  "Nobody can say where a statement came from, or whether it still holds.",
];

// TRUST: what keeps people in charge; the difference from other AI tools
const TRUST = [
  { icon: LinkSimple, title: "Every line has a source", body: "Every sentence links to the file and the page it came from." },
  { icon: ShieldCheck, title: "Risky changes wait for you", body: "Safe updates apply on their own. Conflicts and deletions wait for a person." },
  { icon: ArrowCounterClockwise, title: "Undo anything", body: "Every change is recorded with its cause and can be reversed." },
  { icon: Stack, title: "One answer, not ten versions", body: "Matching facts merge into one, and every source stays attached." },
];

const USE_CASES = [
  { icon: ClipboardText, title: "Process handbooks", body: "Steps that change when the rules change, each traced to the rule." },
  { icon: ArrowsClockwise, title: "Project memory", body: "Dates, owners and decisions that stay current as notes come in." },
  { icon: ShieldCheck, title: "Rules and compliance", body: "Newer documents win, and same day conflicts go to a person." },
  { icon: BookOpenText, title: "Learning a big subject", body: "Long books become linked, sourced pages in minutes." },
  { icon: Brain, title: "Memory for AI agents", body: "One sourced memory your AI tools read and write over MCP." },
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

const COST_QUESTION = "How much does it cost?";

// The FAQ with the price answer written from the plan list while billing is on
function faqFor(billing: boolean): typeof FAQ {
  if (!billing) return FAQ;
  return FAQ.map(f => (f.q === COST_QUESTION ? { q: f.q, a: pricingFaqAnswer() } : f));
}

function faqSchema(faq: typeof FAQ) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.filter(f => !f.placeholder).map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

function SectionHeading({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-[680px] text-center">
      {eyebrow && <p className="text-sm font-semibold text-landing-gold">{eyebrow}</p>}
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-lg text-white/60 text-pretty">{body}</p>}
    </div>
  );
}

export default async function WelcomePage() {
  const billing = await isFeatureEnabled("billing");
  const faq = faqFor(billing);
  return (
    <>
      <LandingNav />
      <main id="main">
        {/* HERO: the glass machine under the outcome headline and the one action */}
        <section className="relative isolate flex min-h-svh flex-col justify-center overflow-hidden px-4 pt-28 pb-12 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-10 text-center">
            <Reveal className="flex flex-col items-center">
              <h1 className="max-w-[680px] bg-linear-to-r from-white to-landing-fade bg-clip-text pb-1 text-4xl font-semibold tracking-tight text-balance text-transparent sm:text-6xl">
                Feed it everything. <br className="hidden sm:inline" />
                Watch it organize.
              </h1>
              <p className="mt-6 max-w-[680px] text-lg text-white/70 text-pretty sm:text-xl">
                Corpus Wiki turns your files into pages, a glossary and stakeholder maps that keep themselves current.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <StartButton />
                {billing ? (
                  <span className="text-sm text-white/50">No card needed</span>
                ) : (
                  <>
                    <span className="text-sm text-white/50">Free to start</span>
                    <PlaceholderTag>Confirm free plan terms</PlaceholderTag>
                  </>
                )}
              </div>
            </Reveal>
            <Reveal delay={150} className="w-full">
              <DemoEmbed concept={6} title="Files feed a graph that organizes itself and produces pages, a glossary and more" minHeight={460} />
            </Reveal>
          </div>
        </section>

        {/* PROBLEM TO SOLUTION */}
        <section id="product" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Your wiki was right the day you wrote it.</h2>
              <ul className="mt-8 flex flex-col gap-4">
                {PROBLEMS.map(p => (
                  <li key={p} className="flex gap-3 text-white/60 text-pretty">
                    <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-landing-conflict" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <p className="text-sm font-semibold text-landing-gold">With Corpus Wiki</p>
              <p className="mt-4 text-xl text-white text-pretty">
                Each new document is read, the facts it touches are found, and only those lines change. Every fact keeps a link to its source, so you can always check it.
              </p>
            </div>
          </Reveal>
        </section>

        {/* TAGLINE REVEAL: the core promise, word by word */}
        <section aria-label="What Corpus Wiki promises" className="px-4 py-24 sm:px-6">
          <TaglineReveal lines={["Every fact knows where it came from.", "Every change knows what it touched."]} />
        </section>

        {/* HOW IT WORKS: the live page, sentences rewriting as sources arrive */}
        <section id="how" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[4fr_7fr]">
            <Reveal>
              <p className="text-sm font-semibold text-landing-gold">How it works</p>
              <h2 className="mt-3 max-w-[680px] text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Pages that rewrite themselves.</h2>
              <p className="mt-4 max-w-[680px] text-lg text-white/65 text-pretty sm:text-xl">A new file arrives. Only the sentences it changes are rewritten, each with its source.</p>
            </Reveal>
            <Reveal delay={150}>
              <DemoEmbed concept={7} title="A wiki page rewriting itself as new sources arrive" minHeight={640} />
            </Reveal>
          </div>
        </section>

        {/* WHAT YOU GET: glossary, dictionary, stakeholders */}
        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Glossary" title="One meaning for every term." body="Definitions update as your sources change. Duplicates merge, and new terms define themselves." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={8} title="A glossary that updates, merges duplicates and adds new terms" minHeight={620} />
          </Reveal>
        </section>

        <section className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Dictionary" title="Your team&apos;s dictionary, written by your files." body="Every term your documents use, defined in plain words, with real examples from your sources." />
          </Reveal>
          <Reveal delay={120} className="mx-auto mt-12 max-w-6xl">
            <DemoEmbed concept={9} title="A dictionary entry gaining meanings and examples from new sources" minHeight={620} />
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

        {/* TRUST AND CONTROL */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="You stay in charge" title="Knowledge you can trust and check" />
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((b, i) => (
              <Reveal key={b.title} delay={i * 80}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-transform duration-500 hover:-translate-y-1 ease-landing">
                  <b.icon className="size-6 text-landing-gold" />
                  <h3 className="mt-4 text-lg font-semibold">{b.title}</h3>
                  <p className="mt-2 text-sm text-white/60 text-pretty">{b.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* USE CASES */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Use cases" title="For knowledge that keeps changing" />
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {USE_CASES.map((b, i) => (
              <Reveal key={b.title} delay={i * 80}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-transform duration-500 hover:-translate-y-1 ease-landing">
                  <b.icon className="size-6 text-landing-gold" />
                  <h3 className="mt-4 text-base font-semibold">{b.title}</h3>
                  <p className="mt-2 text-sm text-white/60 text-pretty">{b.body}</p>
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

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading title="Questions" />
          </Reveal>
          <Reveal className="mx-auto mt-12 flex max-w-3xl flex-col gap-2">
            {faq.map(f => (
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
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema(faq)) }} />
        </section>

        {/* FINAL ACTION: identical to the hero, with the risk reversal */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal className="mx-auto flex max-w-[680px] flex-col items-center text-center">
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Give your business a living source of truth.</h2>
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
            {billing && <li><Link href="/pricing" className={`rounded-md transition-colors duration-300 hover:text-white ${FOCUS}`}>Pricing</Link></li>}
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
