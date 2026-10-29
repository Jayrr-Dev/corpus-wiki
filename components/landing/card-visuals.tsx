// =====================================================================
// CARD VISUALS: one small drawing per trust and use-case card, each showing
// its promise in miniature. Drawn in the demos' five category colours on a
// 240 by 140 canvas; parts nudge when the card (a `group`) is hovered.
// =====================================================================

import type { ReactNode } from "react";

const B = "#4285f4", R = "#ea4335", Y = "#fbbc04", G = "#34a853", P = "#673ab7";
const PAPER = "#efe6d2", INK = "#c9bc9f", INK_DARK = "#8d8169", CARD = "#1f1f1f", LIFT = "#262626", EDGE = "#353535", RULE = "#3c3c3c";
const WHITE = "#ffffff", BRIGHT = "rgba(255,255,255,.8)", DIM = "rgba(255,255,255,.35)";
const GREEN_PALE = "#8fd19e", BLUE_PALE = "#a8c7fa", PURPLE_PALE = "#b39ddb", PURPLE_DARK = "#4a2a86", YELLOW_DARK = "#a87a00";
const MOVE = "transition-transform duration-500 ease-landing motion-reduce:transition-none";

// LINES: a stack of text lines, one width per line
function Lines({ x, y, widths, gap = 10, color = RULE, width = 3 }: { x: number; y: number; widths: number[]; gap?: number; color?: string; width?: number }) {
  return <>{widths.map((w, i) => <path key={i} d={`M${x} ${y + i * gap} H${x + w}`} stroke={color} strokeWidth={width} strokeLinecap="round" />)}</>;
}

// PERSON: head and shoulders, centred on (x, y)
function Person({ x, y, color, r = 7 }: { x: number; y: number; color: string; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r + 6} fill={color} opacity={0.16} />
      <circle cx={x} cy={y - r * 0.35} r={r * 0.45} fill={color} />
      <path d={`M${x - r * 0.8} ${y + r * 0.75} a${r * 0.8} ${r * 0.65} 0 0 1 ${r * 1.6} 0 Z`} fill={color} />
    </g>
  );
}

function Label({ x, y, children, color = "rgba(255,255,255,.55)", anchor = "middle", size = 9, weight = 500 }: { x: number; y: number; children: ReactNode; color?: string; anchor?: "start" | "middle" | "end"; size?: number; weight?: number }) {
  return <text x={x} y={y} fill={color} fontSize={size} fontWeight={weight} textAnchor={anchor} fontFamily="inherit">{children}</text>;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 140" aria-hidden className="block h-auto w-full rounded-xl border border-white/5 bg-black/25">
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------- TRUST

// A highlighted sentence carries a citation that leads to the passage in its PDF
export function SourceVisual() {
  return (
    <Frame>
      <rect x="16" y="16" width="118" height="108" rx="8" fill={CARD} stroke={EDGE} />
      <Lines x={28} y={32} widths={[70, 88]} gap={12} />
      <rect x="24" y="51" width="90" height="12" rx="3" fill={B} opacity={0.22} />
      <path d="M28 57 H104" stroke={BRIGHT} strokeWidth={3} strokeLinecap="round" />
      <circle cx="122" cy="57" r="7" fill={B} />
      <Label x={122} y={60} color="#fff" weight={700}>1</Label>
      <Lines x={28} y={80} widths={[84, 60, 76]} gap={12} />
      <path d="M129 57 C150 57 152 80 170 80" stroke={B} strokeWidth={2} strokeDasharray="3 3" fill="none"
        className="transition-all duration-700 ease-landing group-hover:[stroke-dashoffset:-18]" />
      <g className={`${MOVE} group-hover:-translate-y-1`}>
        <rect x="168" y="30" width="58" height="80" rx="6" fill={PAPER} />
        <path d="M168 36 a6 6 0 0 1 6 -6 H220 a6 6 0 0 1 6 6 V44 H168 Z" fill={R} />
        <Label x={197} y={41} color="#fff" size={8} weight={700}>PDF</Label>
        <Lines x={176} y={56} widths={[40, 34]} gap={9} color={INK} />
        <rect x="173" y="72" width="46" height="11" rx="2" fill={Y} opacity={0.55} />
        <path d="M176 78 H214" stroke={INK_DARK} strokeWidth={3} strokeLinecap="round" />
        <Lines x={176} y={94} widths={[36, 28]} gap={9} color={INK} />
      </g>
    </Frame>
  );
}

// A safe update flows into the page; a deletion stops at a gate for a person
export function ReviewVisual() {
  return (
    <Frame>
      <rect x="164" y="18" width="60" height="104" rx="8" fill={CARD} stroke={EDGE} />
      <Lines x={174} y={34} widths={[40, 32, 40, 26, 36, 30, 40, 22]} gap={10} />
      <g className={`${MOVE} group-hover:translate-x-1.5`}>
        <rect x="14" y="30" width="86" height="26" rx="13" fill={G} fillOpacity={0.15} stroke={G} />
        <Label x={57} y={46} color={GREEN_PALE} size={10} weight={600}>+ Update</Label>
      </g>
      <path d="M106 43 H152" stroke={G} strokeWidth={2} />
      <path d="M148 38 L156 43 L148 48" stroke={G} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="84" width="86" height="26" rx="13" fill={R} fillOpacity={0.15} stroke={R} />
      <Label x={57} y={100} color="#f6aea9" size={10} weight={600}>− Delete</Label>
      <path d="M106 97 H118" stroke={R} strokeWidth={2} strokeDasharray="3 3" />
      <path d="M124 80 V114" stroke={Y} strokeWidth={4} strokeLinecap="round" />
      <g className={`${MOVE} group-hover:-translate-y-1`}>
        <Person x={145} y={97} color={Y} r={8} />
      </g>
      <Label x={145} y={128} color={Y} size={8} weight={600}>You decide</Label>
    </Frame>
  );
}

// Three versions on a timeline, each with its cause; the last one rolls back
export function UndoVisual() {
  const versions = [[52, B, "v1"], [120, Y, "v2"], [188, R, "v3"]] as const;
  return (
    <Frame>
      <path d="M24 74 H216" stroke={RULE} strokeWidth={2} />
      <path d="M186 60 C172 24 136 24 124 58" stroke={Y} strokeWidth={2} fill="none" strokeLinecap="round"
        className="transition-all duration-700 ease-landing [stroke-dasharray:120] [stroke-dashoffset:0] group-hover:[stroke-dashoffset:120] motion-reduce:transition-none" />
      <path d="M118 52 L124 60 L131 53" stroke={Y} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="138" y="18" width="36" height="16" rx="8" fill={Y} />
      <Label x={156} y={29} color="#131209" size={9} weight={700}>Undo</Label>
      {versions.map(([x, c, v], i) => (
        <g key={v} opacity={i === 2 ? 0.45 : 1}>
          <circle cx={x} cy={74} r={10} fill={CARD} stroke={c} strokeWidth={2} strokeDasharray={i === 2 ? "3 3" : undefined} />
          <circle cx={x} cy={74} r={3.5} fill={c} />
          <Label x={x} y={102}>{v}</Label>
          <rect x={x - 18} y={110} width={36} height={12} rx={3} fill={c} opacity={0.2} />
          <path d={`M${x - 12} ${116} H${x + 12}`} stroke={c} strokeWidth={2} strokeLinecap="round" />
        </g>
      ))}
      <circle cx={120} cy={74} r={15} fill="none" stroke={Y} strokeOpacity={0.35} className={`${MOVE} origin-[120px_74px] scale-75 group-hover:scale-100`} />
    </Frame>
  );
}

// Three copies of one fact merge into a single answer that keeps every source
export function MergeVisual() {
  const copies = [[22, B], [56, R], [90, Y]] as const;
  return (
    <Frame>
      {copies.map(([y, c], i) => (
        <g key={y} className={`${MOVE} group-hover:translate-x-1`}>
          <rect x="14" y={y} width="78" height="26" rx="6" fill={CARD} stroke={EDGE} opacity={0.75} />
          <circle cx="26" cy={y + 13} r="4" fill={c} />
          <path d={`M36 ${y + 13} H${78 - i * 8}`} stroke={RULE} strokeWidth={3} strokeLinecap="round" />
          <path d={`M92 ${y + 13} C120 ${y + 13} 124 70 146 70`} stroke={c} strokeOpacity={0.6} strokeWidth={1.5} fill="none" />
        </g>
      ))}
      <rect x="146" y="44" width="80" height="52" rx="8" fill={LIFT} stroke={G} strokeWidth={1.5} />
      <circle cx="160" cy="60" r="7" fill={G} />
      <path d="M156.5 60 l2.5 2.5 l4.5 -5" stroke={WHITE} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Lines x={172} y={60} widths={[44]} color={BRIGHT} />
      <Lines x={156} y={74} widths={[60, 44]} gap={9} />
      {[B, R, Y].map((c, i) => <circle key={c} cx={168 + i * 18} cy={112} r={5} fill={c} />)}
      <path d="M168 96 V107 M186 96 V107 M204 96 V107" stroke={EDGE} strokeWidth={1.5} />
    </Frame>
  );
}

// ---------------------------------------------------------------- USE CASES

// A new PDF arrives and rewrites one line of a handbook page, as a new version
export function DocsVisual() {
  return (
    <Frame>
      <g className={`${MOVE} group-hover:translate-x-1`}>
        <rect x="14" y="40" width="42" height="56" rx="5" fill={PAPER} />
        <path d="M14 45 a5 5 0 0 1 5 -5 H51 a5 5 0 0 1 5 5 V52 H14 Z" fill={R} />
        <Label x={35} y={49.5} color={WHITE} size={7} weight={700}>PDF</Label>
        <Lines x={21} y={62} widths={[26, 20, 24]} gap={8} color={INK} />
      </g>
      <path d="M60 68 C70 68 72 74 80 74" stroke={B} strokeWidth={2} strokeDasharray="3 3" fill="none"
        className="transition-all duration-700 ease-landing group-hover:[stroke-dashoffset:-18]" />
      <rect x="82" y="16" width="96" height="108" rx="8" fill={CARD} stroke={EDGE} />
      <rect x="92" y="27" width="40" height="6" rx="3" fill={BRIGHT} />
      <Lines x={92} y={46} widths={[72, 60]} gap={10} />
      <rect x="89" y="62" width="82" height="10" rx="3" fill={R} opacity={0.15} />
      <path d="M93 67 H150" stroke={R} strokeOpacity={0.6} strokeWidth={3} strokeLinecap="round" />
      <path d="M90 67 H167" stroke={R} strokeOpacity={0.8} strokeWidth={1} />
      <rect x="89" y="76" width="82" height="10" rx="3" fill={G} opacity={0.2} />
      <path d="M93 81 H160" stroke={GREEN_PALE} strokeWidth={3} strokeLinecap="round" />
      <Lines x={92} y={96} widths={[66]} />
      <rect x="92" y="106" width="44" height="12" rx="6" fill={G} fillOpacity={0.2} stroke={G} />
      <Label x={114} y={115} color={GREEN_PALE} size={7} weight={600}>Updated</Label>
      <g opacity={0.45}>
        <rect x="190" y="42" width="36" height="18" rx="9" fill={CARD} stroke={EDGE} />
        <Label x={208} y={54} size={8}>v3</Label>
      </g>
      <g className={`${MOVE} group-hover:-translate-y-1`}>
        <rect x="190" y="70" width="36" height="18" rx="9" fill={B} />
        <Label x={208} y={82} color={WHITE} size={8} weight={700}>v4</Label>
      </g>
      <path d="M208 60 V70" stroke={EDGE} strokeWidth={1.5} />
    </Frame>
  );
}

// Everyday life around one person: chats, plans, notes, workouts, lectures, friends
export function LifeVisual() {
  const spots = [[42, 32], [120, 20], [198, 32], [42, 108], [120, 120], [198, 108]] as const;
  return (
    <Frame>
      {spots.map(([x, y]) => (
        <path key={`${x}${y}`} d={`M${x} ${y} L120 70`} stroke={EDGE} strokeWidth={1.5} strokeDasharray="3 3"
          className="transition-all duration-700 ease-landing group-hover:[stroke-dashoffset:-18]" />
      ))}
      {/* chat */}
      <path d="M28 22 h28 a4 4 0 0 1 4 4 v12 a4 4 0 0 1 -4 4 h-18 l-6 5 v-5 h-4 a4 4 0 0 1 -4 -4 v-12 a4 4 0 0 1 4 -4 Z" fill={B} />
      {[36, 42, 48].map(x => <circle key={x} cx={x} cy={32} r={1.8} fill={WHITE} />)}
      {/* calendar */}
      <rect x="106" y="8" width="28" height="26" rx="4" fill={CARD} stroke={R} strokeWidth={1.5} />
      <path d="M106 12 a4 4 0 0 1 4 -4 H130 a4 4 0 0 1 4 4 V16 H106 Z" fill={R} />
      {[112, 128].map(x => <circle key={x} cx={x} cy={24} r={1.6} fill={RULE} />)}
      <circle cx={120} cy={24} r={2.4} fill={R} />
      {/* gym */}
      <g className={`${MOVE} origin-[198px_32px] group-hover:-rotate-12`}>
        <path d="M184 32 H212" stroke={G} strokeWidth={3} strokeLinecap="round" />
        <rect x="183" y="23" width="6" height="18" rx="2" fill={G} />
        <rect x="207" y="23" width="6" height="18" rx="2" fill={G} />
      </g>
      {/* lecture */}
      <rect x="27" y="97" width="30" height="22" rx="4" fill={P} />
      <path d="M38 102 L47 108 L38 114 Z" fill={WHITE} />
      {/* friend */}
      <Person x={120} y={120} color={PAPER} r={6} />
      {/* note */}
      <g className={`${MOVE} group-hover:-translate-y-1`}>
        <rect x="186" y="96" width="24" height="24" rx="3" fill={Y} transform="rotate(6 198 108)" />
        <path d="M191 104 H205 M191 109 H203 M191 114 H199" stroke={YELLOW_DARK} strokeWidth={2} strokeLinecap="round" transform="rotate(6 198 108)" />
      </g>
      <circle cx={120} cy={70} r={20} fill={LIFT} stroke={DIM} />
      <Person x={120} y={70} color={WHITE} r={9} />
    </Frame>
  );
}

// One client card stays current from emails, calls and invoices
export function ClientVisual() {
  const sources = [[30, Y, "Email"], [62, R, "Call"], [94, P, "Invoice"]] as const;
  const stages = [[32, G, "Lead"], [78, Y, "Proposal"], [124, RULE, "Won"]] as const;
  return (
    <Frame>
      <rect x="14" y="14" width="132" height="112" rx="8" fill={CARD} stroke={EDGE} />
      <circle cx="34" cy="36" r="11" fill={B} fillOpacity={0.25} />
      <Label x={34} y={39.5} color={BLUE_PALE} size={9} weight={700}>AC</Label>
      <Lines x={52} y={32} widths={[64]} color={BRIGHT} />
      <Lines x={52} y={42} widths={[42]} />
      <path d="M32 70 H124" stroke={RULE} strokeWidth={2} />
      {stages.map(([x, c, name], i) => (
        <g key={name}>
          {i === 1 && <circle cx={x} cy={70} r={9} fill={c} opacity={0.25} className={`${MOVE} origin-[78px_70px] scale-75 group-hover:scale-110`} />}
          <circle cx={x} cy={70} r={5} fill={c} />
          <Label x={x} y={88} size={7.5}>{name}</Label>
        </g>
      ))}
      <path d="M24 102 H136" stroke={EDGE} strokeWidth={1} />
      <Label x={24} y={116} anchor="start" size={8}>Last talk</Label>
      <Label x={136} y={116} anchor="end" color={GREEN_PALE} size={8} weight={700}>Today</Label>
      {sources.map(([y, c, name], i) => (
        <g key={name} className={`${MOVE} group-hover:-translate-x-1`}>
          <path d={`M168 ${y + 9} H150`} stroke={c} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="3 3" />
          <rect x="168" y={y} width="58" height="18" rx="9" fill={c} fillOpacity={0.18} stroke={c} />
          <circle cx="178" cy={y + 9} r="3" fill={c} />
          <Label x={186} y={y + 12} anchor="start" color={i === 2 ? PURPLE_PALE : WHITE} size={8} weight={600}>{name}</Label>
        </g>
      ))}
    </Frame>
  );
}

// A thick book opens out into a web of linked, sourced pages
export function BookVisual() {
  const pages = [[150, 22, B], [196, 40, R], [140, 74, G], [192, 92, Y], [150, 112, P]] as const;
  const links = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4]] as const;
  return (
    <Frame>
      <g className={`${MOVE} group-hover:-rotate-3 origin-[48px_70px]`}>
        <rect x="22" y="30" width="56" height="80" rx="4" fill={P} />
        <rect x="26" y="34" width="52" height="72" rx="2" fill={PAPER} />
        <rect x="22" y="30" width="10" height="80" rx="3" fill={PURPLE_DARK} />
        <Lines x={40} y={48} widths={[30, 24, 30, 20, 28, 22]} gap={9} color={INK} />
      </g>
      <path d="M90 70 H118" stroke={DIM} strokeWidth={2} />
      <path d="M113 65 L119 70 L113 75" stroke={DIM} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {links.map(([a, b]) => (
        <path key={`${a}${b}`} d={`M${pages[a][0] + 14} ${pages[a][1] + 9} L${pages[b][0] + 14} ${pages[b][1] + 9}`} stroke={EDGE} strokeWidth={1.5} />
      ))}
      {pages.map(([x, y, c]) => (
        <g key={`${x}${y}`}>
          <rect x={x} y={y} width="28" height="18" rx="3" fill={CARD} stroke={EDGE} />
          <rect x={x} y={y} width="28" height="5" rx="2" fill={c} />
          <path d={`M${x + 5} ${y + 11} H${x + 21}`} stroke={RULE} strokeWidth={2} strokeLinecap="round" />
        </g>
      ))}
    </Frame>
  );
}

// Four AI tools read from and write to one memory over MCP
export function AgentsVisual() {
  const agents = [[40, 32, R, "C"], [200, 32, P, "Cu"], [40, 108, G, "G"], [200, 108, B, "Ge"]] as const;
  return (
    <Frame>
      {agents.map(([x, y, c]) => (
        <path key={`${x}${y}`} d={`M${x} ${y} L120 70`} stroke={c} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="3 3"
          className="transition-all duration-700 ease-landing group-hover:[stroke-dashoffset:-18]" />
      ))}
      {agents.map(([x, y, c, a]) => (
        <g key={a}>
          <rect x={x - 15} y={y - 12} width="30" height="24" rx="7" fill={c} fillOpacity={0.2} stroke={c} />
          <Label x={x} y={y + 4} color="#fff" size={10} weight={700}>{a}</Label>
        </g>
      ))}
      <g className={`${MOVE} origin-[120px_70px] group-hover:scale-105`}>
        <rect x="96" y="48" width="48" height="44" rx="10" fill={LIFT} stroke={G} strokeWidth={1.5} />
        <ellipse cx="120" cy="62" rx="12" ry="4" fill="none" stroke={GREEN_PALE} strokeWidth={1.8} />
        <path d="M108 62 V76 a12 4 0 0 0 24 0 V62 M108 69 a12 4 0 0 0 24 0" stroke={GREEN_PALE} strokeWidth={1.8} fill="none" />
      </g>
      <rect x="102" y="98" width="36" height="14" rx="7" fill={LIFT} stroke={EDGE} />
      <Label x={120} y={108} color="rgba(255,255,255,.7)" size={8} weight={600}>MCP</Label>
    </Frame>
  );
}
