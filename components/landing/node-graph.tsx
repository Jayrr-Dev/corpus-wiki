"use client";

import { useEffect, useRef } from "react";
import { layerProps, type LayerProps } from "@/components/standard/layer";

// =====================================================================
// NODE GRAPH: a slowly turning 3D knowledge graph drawn on a canvas, the
// same clustered graph as the launch video's end card, with knowledge
// titles fading in and out beside random nodes
// (docs/launch-video/product-shots/g29-endcard.html). Coloured clusters
// around hub nodes, faint links between hubs, nearer nodes brighter.
// It is seeded, so every visit draws the same graph. It only animates
// while on screen, and draws one still frame for reduced motion.
// =====================================================================

const COLORS = ["#8fae8d", "#72b7e5", "#d9a032", "#8278cb", "#36ab78", "#e88070", "#52c4c4", "#b09de0", "#c66fa5", "#91a64b"];

type GraphNode = { x: number; y: number; z: number; deg: number; hub: boolean; c: number; ph: number; amp: number };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGraph(seed: number, hubs: number, perHub: [number, number]) {
  const r = rng(seed);
  const gauss = () => (r() + r() + r() + r() - 2) / 1.15;
  const nodes: GraphNode[] = [], links: [number, number][] = [], hubIdx: number[] = [];
  for (let h = 0; h < hubs; h++) {
    const u = r() * 2 - 1, th = ((h + r() * 0.6) / hubs) * Math.PI * 2, R = 380 + r() * 120, s = Math.sqrt(1 - u * u);
    hubIdx.push(nodes.length);
    nodes.push({ x: Math.cos(th) * s * R * 1.9, y: u * R * 0.65, z: Math.sin(th) * s * R, deg: 0, hub: true, c: h, ph: 0, amp: 0 });
    const hi = nodes.length - 1, hub = nodes[hi]!, first = nodes.length;
    const n = perHub[0] + Math.floor(r() * (perHub[1] - perHub[0]));
    for (let i = 0; i < n; i++) {
      const sp = 80 + r() * 70;
      nodes.push({ x: hub.x + gauss() * sp, y: hub.y + gauss() * sp, z: hub.z + gauss() * sp, deg: 0, hub: false, c: h, ph: 0, amp: 0 });
      links.push([hi, nodes.length - 1]);
      if (i > 1 && r() < 0.35) links.push([first + Math.floor(r() * i), nodes.length - 1]);
    }
  }
  for (let i = 0; i < hubIdx.length; i++) for (let j = i + 1; j < hubIdx.length; j++) if (r() < 0.3) links.push([hubIdx[i]!, hubIdx[j]!]);
  for (const [a, b] of links) { nodes[a]!.deg++; nodes[b]!.deg++; }
  for (const n of nodes) { n.ph = r() * 6.28; n.amp = 4 + r() * 8; }
  return { nodes, links };
}

const GRAPH = makeGraph(29, 10, [10, 18]);
const FOCAL = 1600;

// Where each node sits on screen at time t (seconds) in a w x h canvas of CSS pixels
function project(t: number, w: number, h: number) {
  const scale = Math.max(w / 1920, h / 1080);
  const rotY = 0.6 + t * 0.05, rotX = -0.25;
  const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
  return GRAPH.nodes.map((n) => {
    let x = n.x + Math.sin(t * 0.9 + n.ph) * n.amp, y = n.y + Math.cos(t * 0.7 + n.ph * 1.3) * n.amp, z = n.z;
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    const s = (FOCAL / (FOCAL + z + 400)) * scale;
    return { x: w / 2 + x * s, y: h / 2 + y * s, s, z };
  });
}

// KNOWLEDGE TITLES: every LABEL_EVERY seconds a title fades in beside a random
// node, holds, and fades out, so two or three show at once. The node is picked
// where it stood when its title began, outside the middle column where the
// headline sits and inside the edges. Synthetic titles, like the demos'.
const TITLES = ["Billing sync", "Refund rules", "Onboarding", "Release runbook", "Pricing tiers", "On-call rota", "Data retention", "Q3 roadmap", "Payment providers", "Brent's handover", "Invoice errors", "Vendor contracts", "Incident review", "Support macros", "Deploy steps", "Security review", "Team glossary", "Hiring plan"];
const LABEL_EVERY = 1.5, LABEL_LIFE = 4.6, LABEL_FADE = 0.8;

function labelAt(slot: number, w: number, h: number) {
  const r = rng(slot * 7919 + 13);
  const P = project(slot * LABEL_EVERY, w, h);
  const middle = Math.min(520, w * 0.38), edge = 24;
  for (let tries = 0; tries < 40; tries++) {
    const i = Math.floor(r() * P.length), p = P[i]!;
    if (Math.abs(p.x - w / 2) < middle || p.x < edge || p.x > w - 160 || p.y < 96 || p.y > h - edge || p.z > 300) continue;
    return { node: i, title: TITLES[Math.floor(r() * TITLES.length)]! };
  }
  return null;
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, ink: string, font: string) {
  const P = project(t, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1.2 * Math.max(w / 1920, h / 1080);
  for (const [a, b] of GRAPH.links) {
    const na = GRAPH.nodes[a]!, nb = GRAPH.nodes[b]!, pa = P[a]!, pb = P[b]!;
    ctx.strokeStyle = na.c === nb.c ? COLORS[na.c % COLORS.length] + "40" : "rgba(150,150,150,.16)";
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  const order = P.map((_, i) => i).sort((i, j) => P[j]!.z - P[i]!.z);
  for (const i of order) {
    const n = GRAPH.nodes[i]!, p = P[i]!;
    const near = Math.min(1, Math.max(0.3, 1 - (p.z + 500) / 1400));
    const r = (n.hub ? 9 : 3.2 + Math.min(n.deg, 6) * 0.5) * p.s;
    ctx.fillStyle = COLORS[n.c % COLORS.length] + Math.round(255 * (0.35 + 0.65 * near)).toString(16).padStart(2, "0");
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `600 12px ${font}`;
  ctx.textBaseline = "middle";
  for (let slot = Math.max(0, Math.floor((t - LABEL_LIFE) / LABEL_EVERY)); slot * LABEL_EVERY <= t; slot++) {
    const age = t - slot * LABEL_EVERY;
    if (age > LABEL_LIFE) continue;
    const label = labelAt(slot, w, h);
    if (!label) continue;
    const fade = Math.min(1, age / LABEL_FADE, (LABEL_LIFE - age) / LABEL_FADE);
    const eased = 1 - Math.pow(1 - fade, 3);
    const n = GRAPH.nodes[label.node]!, p = P[label.node]!;
    const r = (n.hub ? 9 : 3.2 + Math.min(n.deg, 6) * 0.5) * p.s;
    ctx.globalAlpha = eased;
    ctx.strokeStyle = COLORS[n.c % COLORS.length]!;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.globalAlpha = eased * 0.8;
    ctx.fillText(label.title, p.x + r + 10, p.y - 4 * (1 - eased));
  }
  ctx.globalAlpha = 1;
}

export function NodeGraph(props: LayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Starts partway in so the first frame (and the reduced motion still) already shows titles
    let w = 0, h = 0, frame = 0, visible = false, elapsed = 2.6, last = 0;

    // The titles take the page's ink colour and font, so they follow the theme
    const render = () => {
      const css = getComputedStyle(canvas);
      draw(ctx, w, h, elapsed, css.color, css.fontFamily);
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    };
    const tick = (now: number) => {
      elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      render();
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      if (visible && !still.matches && !document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const seen = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); sync(); });
    seen.observe(canvas);
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    document.addEventListener("visibilitychange", sync);
    still.addEventListener("change", sync);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      seen.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", sync);
      still.removeEventListener("change", sync);
    };
  }, []);

  const layer = layerProps(props, "node-graph");
  return <canvas ref={ref} {...layer} className={`${layer.className} size-full text-landing-ink`} />;
}
