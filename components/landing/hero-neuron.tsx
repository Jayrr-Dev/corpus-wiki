// HERO NEURON: a golden neuron drawn from a fixed seed, so server and client
// draw the same branches. Swap for a rendered image later if one is made; the
// hero only needs something that fills the right side behind the copy.

type Branch = { d: string; width: number; tip: [number, number] };

// Small seeded random source (mulberry32), so the drawing never changes between loads
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOMA: [number, number] = [820, 330];

// Grows one dendrite as gently curved segments that split as they thin out
function grow(rand: () => number, out: Branch[], from: [number, number], angle: number, length: number, depth: number) {
  const bend = (rand() - 0.5) * 0.7;
  const to: [number, number] = [from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length];
  const mid: [number, number] = [
    (from[0] + to[0]) / 2 + Math.cos(angle + Math.PI / 2) * length * bend * 0.4,
    (from[1] + to[1]) / 2 + Math.sin(angle + Math.PI / 2) * length * bend * 0.4,
  ];
  out.push({ d: `M${from[0].toFixed(1)} ${from[1].toFixed(1)}Q${mid[0].toFixed(1)} ${mid[1].toFixed(1)} ${to[0].toFixed(1)} ${to[1].toFixed(1)}`, width: depth * 0.75 + 0.3, tip: to });
  if (depth <= 0) return;
  const children = depth > 2 ? 2 : 1 + Math.round(rand());
  for (let i = 0; i < children; i++) {
    const spread = (i - (children - 1) / 2) * (0.5 + rand() * 0.4);
    grow(rand, out, to, angle + spread + (rand() - 0.5) * 0.3, length * (0.62 + rand() * 0.18), depth - 1);
  }
}

function drawNeuron() {
  const rand = seeded(7);
  const branches: Branch[] = [];
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const angle = (i / arms) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    // The long axon runs down and to the left, under the copy
    const long = i === 4;
    grow(rand, branches, SOMA, angle, long ? 300 : 160 + rand() * 80, long ? 6 : 5);
  }
  // Sparks sit along the finer branch tips
  const sparks = branches
    .filter((_, i) => i % 2 === 0)
    .map((b, i) => ({ x: b.tip[0], y: b.tip[1], r: 1 + (i % 3), delay: (i * 370) % 2400 }));
  return { branches, sparks };
}

const { branches, sparks } = drawNeuron();

export function HeroNeuron({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" className={className}>
      <defs>
        <filter id="neuron-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <radialGradient id="neuron-soma">
          <stop offset="0%" stopColor="var(--color-landing-core)" />
          <stop offset="45%" stopColor="var(--color-landing-glow)" />
          <stop offset="100%" stopColor="var(--color-landing-ember)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Soft glow layer under the crisp branches */}
      <g filter="url(#neuron-glow)" stroke="var(--color-landing-glow)" fill="none" strokeLinecap="round" opacity="0.4">
        {branches.map((b, i) => <path key={i} d={b.d} strokeWidth={b.width * 3} />)}
      </g>
      <g stroke="var(--color-landing-glow)" fill="none" strokeLinecap="round">
        {branches.map((b, i) => <path key={i} d={b.d} strokeWidth={b.width} opacity={0.5 + Math.min(b.width, 6) / 12} />)}
      </g>
      <circle cx={SOMA[0]} cy={SOMA[1]} r="60" fill="url(#neuron-soma)" opacity="0.85" />
      <circle cx={SOMA[0]} cy={SOMA[1]} r="16" fill="var(--color-landing-spark)" filter="url(#neuron-glow)" />
      {sparks.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="var(--color-landing-spark)"
          style={{ animationDelay: `${s.delay}ms` }}
          className="animate-pulse motion-reduce:animate-none"
        />
      ))}
    </svg>
  );
}
