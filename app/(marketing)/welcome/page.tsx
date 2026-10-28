import Link from "next/link";
import {
  ArrowRight, ArrowsClockwise, Asterisk, Circle, CircleHalf, Diamond, Files, Graph, Hexagon,
  LinkSimple, Plus, ShieldCheck, Stack, Triangle,
} from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand/BrandMark";
import { HeroNeuron } from "@/components/landing/hero-neuron";
import { LandingNav } from "@/components/landing/landing-nav";
import { ClaimGraphMock, PlaceholderTag, PolicyDiffMock } from "@/components/landing/product-mocks";
import { Reveal } from "@/components/landing/reveal";
import { TaglineReveal } from "@/components/landing/tagline-reveal";

// =====================================================================
// LANDING PAGE (/welcome): one offer, one audience, one action.
// Built to the landing-page-design skill: Geist only, Tailwind scale sizes,
// spacing from the 2 to 96px set, flat backgrounds, Phosphor icons.
// Anything marked with <PlaceholderTag> needs real content before launch.
// =====================================================================

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

const LOGO_SHAPES = [Hexagon, CircleHalf, Asterisk, Diamond, Triangle, Circle];

const PROBLEMS = [
  "A policy changes in a PDF. The wiki page that quotes it stays the same.",
  "Three teams keep three versions of the same answer.",
  "Nobody can say where a statement came from, or whether it still holds.",
];

const BENEFITS = [
  { icon: ArrowsClockwise, title: "Always current", body: "A new version of a file updates the claims it touches, not at the next yearly review." },
  { icon: LinkSimple, title: "Traced to the source", body: "Every claim links to the file and the page it came from." },
  { icon: ShieldCheck, title: "You stay in charge", body: "AI drafts each change. Anything risky waits for a person to approve it." },
  { icon: Stack, title: "One answer, not ten versions", body: "Matching claims merge into one, and every source stays attached." },
];

const STEPS = [
  { n: "01", icon: Files, title: "Upload documents", body: "Add PDF, Word and Markdown files: policies, reports and handbooks." },
  { n: "02", icon: Graph, title: "Connect the claims", body: "Each file is broken into single claims, linked across every source." },
  { n: "03", icon: ArrowsClockwise, title: "Stay current", body: "Newer files update only the claims that changed, with a record of why." },
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
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-lg text-white/60 text-pretty">{body}</p>}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <>
      <LandingNav />
      <main id="main">
        {/* HERO: outcome headline, one action, one proof row, the golden neuron behind */}
        <section className="relative isolate flex min-h-svh flex-col justify-center overflow-hidden px-4 pt-24 pb-12 sm:px-6">
          <HeroNeuron className="absolute inset-0 -z-10 size-full opacity-60 [mask-image:linear-gradient(to_right,transparent_10%,black_60%)] sm:opacity-90" />
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <h1 className="max-w-[680px] bg-linear-to-r from-white to-landing-fade bg-clip-text pb-1 text-4xl font-semibold tracking-tight text-balance text-transparent sm:text-5xl">
                {/* The break only on wider screens; phones balance the lines themselves */}
                Business documents <br className="hidden sm:inline" />
                that are never out of date
              </h1>
              <p className="mt-6 max-w-[680px] text-lg text-white/70 text-pretty sm:text-xl">
                Corpus Wiki turns your files into linked claims that trace back to their source and update when a new version arrives.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <StartButton />
                <span className="text-sm text-white/50">Free to start</span>
                <PlaceholderTag>Confirm free plan terms</PlaceholderTag>
              </div>
            </Reveal>
            <Reveal delay={150} className="mt-20">
              <p className="sr-only">Teams that use Corpus Wiki</p>
              <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
                {LOGO_SHAPES.map((Shape, i) => (
                  <li key={i} className="flex items-center gap-3 text-white/40">
                    <Shape weight="fill" className="size-6 shrink-0" />
                    <span className="text-xs">Company logo<br />placeholder</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* TAGLINE REVEAL: the core promise, word by word */}
        <section aria-label="What Corpus Wiki promises" className="px-4 py-24 sm:px-6">
          <TaglineReveal lines={["Every fact knows where it came from.", "Every change knows what it touched."]} />
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
                Each new document is read, the claims it touches are found, and only those lines change. Every claim keeps a link to its source, so you can always check it.
              </p>
            </div>
          </Reveal>
        </section>

        {/* BENEFITS */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Why teams use it" title="Knowledge you can trust and check" />
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b, i) => (
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

        {/* HOW IT WORKS */}
        <section id="how" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading title="From documents to living knowledge" body="A clear path from source material to shared understanding." />
          </Reveal>
          <div className="mx-auto mt-16 grid max-w-6xl gap-12 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <div className="flex flex-col items-center text-center">
                  <span className="grid size-20 place-items-center rounded-full border border-landing-gold/40 text-landing-glow">
                    <s.icon className="size-8" />
                  </span>
                  <p className="mt-6 text-sm font-semibold text-landing-gold">{s.n}</p>
                  <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-white/60 text-pretty">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* FEATURE: trace a claim */}
        <section className="px-4 py-24 sm:px-6">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_2fr]">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Follow every claim back to its source.</h2>
              <p className="mt-4 text-lg text-white/60 text-pretty">See the evidence behind a claim, the claims that support it, and the ones that disagree.</p>
            </Reveal>
            <Reveal delay={120}>
              <ClaimGraphMock />
            </Reveal>
          </div>
        </section>

        {/* FEATURE: update what changed */}
        <section className="px-4 py-24 sm:px-6">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[3fr_2fr]">
            <Reveal className="order-2 lg:order-1">
              <PolicyDiffMock />
            </Reveal>
            <Reveal delay={120} className="order-1 lg:order-2">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Keep the knowledge. Update what changed.</h2>
              <p className="mt-4 text-lg text-white/60 text-pretty">A new document refreshes the claims it affects, with a trail back to the evidence.</p>
            </Reveal>
          </div>
        </section>

        {/* SOCIAL PROOF: placeholders until real quotes arrive */}
        <section className="px-4 py-24 sm:px-6">
          <Reveal>
            <SectionHeading eyebrow="Customer stories" title="What teams say" />
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 md:grid-cols-3">
            {["saving time when policies change", "trusting answers without checking", "onboarding new staff faster"].map((topic, i) => (
              <Reveal key={topic} delay={i * 80}>
                <figure className="flex h-full flex-col rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6">
                  <PlaceholderTag />
                  <blockquote className="mt-4 flex-1 text-white/50 text-pretty">A short customer quote about {topic}.</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-full bg-landing-gold/20 text-sm font-semibold text-landing-glow">AB</span>
                    <span className="text-sm">
                      <span className="block text-white/80">Customer name</span>
                      <span className="block text-white/40">Role, company</span>
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
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
