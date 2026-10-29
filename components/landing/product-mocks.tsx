import { CaretRight, FileText, Graph, ListBullets, MagnifyingGlass, Files } from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand/BrandMark";

// =====================================================================
// PRODUCT MOCKS: drawn in markup rather than screenshots, so they stay sharp
// and match the page. Replace with real screenshots once the app is styled to match.
// =====================================================================

// PLACEHOLDER TAG: marks anything that still needs real content before launch
export function PlaceholderTag({ children = "Placeholder" }: { children?: string }) {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-dashed border-landing-gold/60 px-2 py-0.5 text-xs font-medium text-landing-gold">
      {children}
    </span>
  );
}

const NODES = [
  { id: "a", x: 120, y: 70 }, { id: "b", x: 300, y: 40 }, { id: "c", x: 60, y: 200 },
  { id: "d", x: 250, y: 160 }, { id: "e", x: 110, y: 330 }, { id: "f", x: 420, y: 340 },
  { id: "g", x: 470, y: 90 }, { id: "h", x: 40, y: 400 }, { id: "i", x: 520, y: 220 },
];
const LINKS: [string, string][] = [["a", "b"], ["a", "c"], ["c", "e"], ["e", "h"], ["b", "g"], ["g", "i"], ["f", "i"], ["c", "h"]];
const CENTER = { x: 250, y: 160 };
const pos = (id: string) => NODES.find(n => n.id === id)!;

// CLAIM GRAPH WINDOW: the graph view with one claim open beside it
export function ClaimGraphMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-landing-ink/10 bg-landing-surface p-2 shadow-2xl shadow-landing-ink/10 dark:shadow-black/50">
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="size-2 rounded-full bg-landing-ink/20" />
        <span className="size-2 rounded-full bg-landing-ink/20" />
        <span className="size-2 rounded-full bg-landing-ink/20" />
      </div>
      <div className="flex overflow-hidden rounded-lg border border-landing-ink/10 bg-landing-base">
        <aside className="hidden w-40 shrink-0 flex-col gap-1 bg-landing-ink/[0.03] p-3 text-xs text-landing-ink/60 xl:flex">
          <span className="mb-2 flex items-center gap-2 text-landing-ink">
            <BrandMark className="size-4 text-landing-green-light" />
            <span className="font-brand text-base">Corpus Wiki</span>
          </span>
          <span className="flex items-center gap-2 rounded-md bg-landing-green/30 px-2 py-2 text-landing-ink"><Graph className="size-4" />Knowledge graph</span>
          <span className="flex items-center gap-2 px-2 py-2"><Files className="size-4" />Documents</span>
          <span className="flex items-center gap-2 px-2 py-2"><ListBullets className="size-4" />Claims</span>
          <span className="flex items-center gap-2 px-2 py-2"><MagnifyingGlass className="size-4" />Search</span>
        </aside>
        <div className="relative min-w-0 flex-1">
          <svg viewBox="0 0 560 440" className="block h-auto w-full" role="img" aria-label="A claim in the knowledge graph, linked to the claims that support it and one that contradicts it">
            <g stroke="var(--color-landing-gold)" strokeOpacity="0.25" strokeWidth="1">
              {LINKS.map(([from, to]) => <line key={from + to} x1={pos(from).x} y1={pos(from).y} x2={pos(to).x} y2={pos(to).y} />)}
            </g>
            {/* The open claim: three supporting links and one contradicting one */}
            <g stroke="var(--color-landing-glow)" strokeWidth="1.5">
              <line x1={CENTER.x} y1={CENTER.y} x2={pos("a").x} y2={pos("a").y} />
              <line x1={CENTER.x} y1={CENTER.y} x2={pos("e").x} y2={pos("e").y} />
              <line x1={CENTER.x} y1={CENTER.y} x2={pos("b").x} y2={pos("b").y} />
            </g>
            <line x1={CENTER.x} y1={CENTER.y} x2={pos("f").x} y2={pos("f").y} stroke="var(--color-landing-conflict)" strokeWidth="1.5" strokeDasharray="4 4" />
            <g fill="var(--color-landing-glow)" fontSize="11">
              <text x="160" y="105" fill="var(--color-landing-label)">supports</text>
              <text x="140" y="250" fill="var(--color-landing-label)">supports</text>
              <text x="285" y="95" fill="var(--color-landing-label)">supports</text>
              <text x="345" y="265" fill="var(--color-landing-conflict)">contradicts</text>
            </g>
            {NODES.map(n => (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r="9" fill="var(--color-landing-glow)" opacity="0.2" />
                <circle cx={n.x} cy={n.y} r="4" fill={n.id === "f" ? "var(--color-landing-conflict)" : "var(--color-landing-glow)"} />
              </g>
            ))}
            <circle cx={CENTER.x} cy={CENTER.y} r="14" fill="none" stroke="var(--color-landing-glow)" strokeWidth="1.5" />
            <rect x="272" y="140" width="150" height="40" rx="8" fill="var(--color-landing-surface)" stroke="var(--color-landing-ink)" strokeOpacity="0.2" />
            <text x="284" y="158" fontSize="11" fill="var(--color-landing-ink)">Customer data is</text>
            <text x="284" y="172" fontSize="11" fill="var(--color-landing-ink)">encrypted at rest.</text>
          </svg>
        </div>
        <aside className="hidden w-56 shrink-0 flex-col gap-4 bg-landing-ink/[0.03] p-4 text-xs sm:flex">
          <div>
            <p className="text-sm font-semibold text-landing-ink text-balance">Customer data is encrypted at rest.</p>
            <p className="mt-2 text-landing-ink/60 text-pretty">All customer data stored in our production systems is encrypted while stored.</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-landing-ink/50">Source</span>
            <span className="flex items-center gap-2 rounded-lg border border-landing-ink/10 p-2 text-landing-ink/80">
              <FileText className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">Security handbook.pdf<br /><span className="text-landing-ink/50">Page 12</span></span>
              <CaretRight className="size-3" />
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-landing-ink/50">Supporting claims</span>
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-landing-glow" /><span className="h-1 flex-1 rounded-full bg-landing-ink/15" /></span>
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-landing-glow" /><span className="h-1 flex-1 rounded-full bg-landing-ink/15" /></span>
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-landing-glow" /><span className="h-1 flex-1 rounded-full bg-landing-ink/15" /></span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-landing-ink/50">Contradicting claims</span>
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-landing-conflict" /><span className="h-1 flex-1 rounded-full bg-landing-ink/15" /></span>
          </div>
        </aside>
      </div>
    </div>
  );
}

// POLICY CHANGE CARD: an updated file compared with the version before, and the claim it changed
export function PolicyDiffMock() {
  return (
    <div className="rounded-2xl border border-landing-ink/10 bg-landing-surface p-6">
      <div className="flex items-center gap-3">
        <FileText className="size-6 text-landing-ink/80" />
        <div>
          <p className="text-sm font-semibold text-landing-ink">Travel policy 2026.pdf</p>
          <p className="text-xs text-landing-ink/50">Compared with the version from March</p>
        </div>
      </div>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <span className="w-fit rounded-md border border-landing-ink/15 px-2 py-1 text-xs text-landing-ink/70">Previous</span>
          <p className="text-sm text-landing-ink/70 text-pretty">
            Business travel is reimbursed for airfare, lodging and ground transport,{" "}
            <mark className="rounded bg-landing-gold/25 px-0.5 text-landing-gold-pale">within set limits and with prior approval from your manager.</mark>
          </p>
          <div className="rounded-lg border border-landing-ink/10 p-3">
            <p className="text-xs font-semibold text-landing-ink">Claim 4.2</p>
            <p className="mt-1 text-xs text-landing-ink/60">Travel expenses need prior manager approval.</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <span className="w-fit rounded-md border border-landing-green-light/60 bg-landing-green/30 px-2 py-1 text-xs text-landing-green-pale">Updated</span>
          <p className="text-sm text-landing-ink/70 text-pretty">
            Business travel is reimbursed for airfare, lodging and ground transport,{" "}
            <mark className="rounded bg-landing-green/50 px-0.5 text-landing-green-pale">within updated limits. Prior approval is no longer needed.</mark>
          </p>
          <div className="rounded-lg border border-landing-green-light/40 p-3">
            <p className="text-xs font-semibold text-landing-ink">Claim 4.2, revised</p>
            <p className="mt-1 text-xs text-landing-ink/60">Travel expenses no longer need prior manager approval.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
