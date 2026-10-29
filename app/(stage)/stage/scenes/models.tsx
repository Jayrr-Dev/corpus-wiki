"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { useEffect, useLayoutEffect, useState } from "react";
import { AiFlowTab } from "@/app/(app)/workflow/AiFlowTab";
import { AI_FLOW } from "@/app/(app)/workflow/aiFlowCanvas";
import { HALF } from "@/app/(app)/workflow/canvasTypes";
import { Camera, easeOut, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { AI_STAGES, type SkillLibrary } from "@/lib/ai/skills/types";
import { cn } from "@/lib/utils";
import { fakeDate } from "@/lib/video-stage/phoenix/core";
import { MODEL_GROUPS, MODEL_IDS, modelGroupOf, type ModelGroup } from "@/lib/video-stage/phoenix/control";
import { ORIGIN, useFrameRects, type FrameRect } from "./exception";

// =====================================================================
// MODELS: the Nemotron roles, in time with the voice. Workflow, AI
// handoffs: the "How your AI roles work together" canvas lights each
// model's roles in turn (Super, Ultra, Nano, then Vision) with the
// model's name, and the camera moves slowly between them. 17.4 seconds.
// =====================================================================

// The built-in skills, each assigned to its stage, as the library query returns them
const LIBRARY: SkillLibrary = {
  skills: AI_STAGES.map(({ id }) => {
    const skill = defaultSkill(id);
    return { id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, version: skill.version, builtin_key: id, archived_at: null, updated_at: fakeDate("2026-01-05") };
  }),
  assignments: AI_STAGES.map(({ id }) => ({ stage: id, skill_id: defaultSkill(id).id })),
};

// Each group's colour: NVIDIA green for Super, then one hue per model so the groups read apart
const TONE: Record<ModelGroup, string> = { super: "#76b900", ultra: "#f2b84b", nano: "#4fc3f7", vision: "#c792ea" };
const SHORT: Record<ModelGroup, string> = { super: "Super", ultra: "Ultra", nano: "Nano", vision: "Vision" };

// The shapes in the order FlowCanvas draws them (every node but the bus), with their model group
const SHAPES = AI_FLOW.nodes.filter((node) => node.shape !== "bus").map((node) => ({ node, group: modelGroupOf(node.roleId) }));

// Shapes below this canvas y sit just under a group title, so their tag goes beside them
const CANVAS_GROUP_TOP = 1300;

// The canvas is 72vh tall in the app; the stage pins it so the browser preview and the renderer agree
const STAGE_CSS = `section[aria-label="AI flow"] > div[tabindex="0"] { height: 700px !important; min-height: 0 !important; }`;

const groupAt = (group: ModelGroup) => MODEL_GROUPS.find((entry) => entry.group === group)!.at;
// The group whose line is playing at t (null before the first)
function currentGroup(t: number): ModelGroup | null {
  return [...MODEL_GROUPS].reverse().find((entry) => t >= entry.at)?.group ?? null;
}

// The workflow screen's own tab strip (SkillsScreen.tsx), with AI handoffs open
function WorkflowTabs() {
  const tabs = [["overview", "Workflow overview"], ["assignments", "Skill assignments"], ["library", "Skill library"], ["flows", "Pipeline diagrams"], ["ai-flow", "AI handoffs"]] as const;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b">
    <div role="tablist" aria-label="Workflow views" className="flex flex-wrap gap-1">
      {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={id === "ai-flow"} className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-panel", id === "ai-flow" ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground")}>
        {label}{id === "library" ? <span className="rounded-sm bg-hover px-1.5 font-mono text-xs text-muted-foreground">{LIBRARY.skills.length}</span> : null}
      </button>)}
    </div>
  </div>;
}

function Models({ t }: { t: number }) {
  // Opens on the whole flow, as the canvas's own "Show the whole flow" button does, after its first fit
  const [, remeasure] = useState(0);
  useEffect(() => {
    const showAll = () => {
      document.querySelector<HTMLButtonElement>('section[aria-label="AI flow"] button[aria-label="Show the whole flow"]')?.click();
      requestAnimationFrame(() => remeasure((n) => n + 1));
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(showAll));
    const timer = window.setTimeout(showAll, 300);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, []);
  const [origin, rects] = useFrameRects((frame) => {
    const canvas = frame.querySelector('section[aria-label="AI flow"] > div[tabindex="0"]');
    return { canvas, world: canvas?.firstElementChild };
  });

  // Unlit shapes, arrows and labels dim (FlowCanvas's own data-dim look); lit ones stay full
  const current = currentGroup(t);
  const lit = (group: ModelGroup | null) => !!group && t >= groupAt(group);
  useLayoutEffect(() => {
    const world = document.querySelector('section[aria-label="AI flow"] > div[tabindex="0"]')?.firstElementChild;
    if (!world) return;
    const dimming = t >= MODEL_GROUPS[0]!.at;
    const set = (element: Element | null | undefined, dim: boolean) => {
      if (element instanceof HTMLElement || element instanceof SVGElement) {
        if (dim) element.dataset.dim = "true";
        else delete element.dataset.dim;
      }
    };
    const shapes = [...world.querySelectorAll(":scope > button[data-shape]")];
    shapes.forEach((shape, index) => {
      const dim = dimming && !lit(SHAPES[index]?.group ?? null);
      set(shape, dim);
      const short = shape.nextElementSibling;
      if (short?.tagName === "SPAN" && !short.hasAttribute("data-kind")) set(short, dim);
    });
    for (const element of world.querySelectorAll(":scope > svg path, :scope > span[data-kind], :scope > button:not([data-shape])")) set(element, dimming);
  });

  const world = rects.world;
  const scale = world ? world.w / AI_FLOW.width : 0.3;
  const at = (x: number, y: number) => world ? { x: world.x + x * scale, y: world.y + y * scale } : { x: 960, y: 540 };
  // The centre of a group's shapes in frame pixels, where the camera aims
  const centre = (group: ModelGroup) => {
    const points = SHAPES.filter((shape) => shape.group === group).map(({ node }) => at(node.x, node.y));
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  };
  const whole = rects.canvas ? { x: rects.canvas.cx, y: rects.canvas.cy } : { x: 1100, y: 600 };
  const ultra = centre("ultra"), nano = centre("nano"), vision = centre("vision");

  return (
    <StageProviders>
      <style>{STAGE_CSS}</style>
      <Camera t={t} keys={[
        [0, 1, whole.x, whole.y], [5.7, 1.05, whole.x, whole.y],
        [6.9, 1.3, ultra.x, ultra.y], [10.7, 1.36, ultra.x, ultra.y],
        [11.8, 1.85, nano.x, nano.y], [12.6, 1.9, nano.x, nano.y],
        [13.6, 1.7, vision.x, vision.y], [17.4, 1.8, vision.x, vision.y],
      ]}>
        <div ref={origin} style={ORIGIN} />
        <StageShell title="Workflow" width="full">
          <div className="space-y-5">
            <WorkflowTabs />
            <AiFlowTab library={LIBRARY} onNavigate={() => {}} />
          </div>
        </StageShell>
        {world ? SHAPES.map(({ node, group }) => group && lit(group) ? <NodeGlow key={node.id} t={t} group={group} current={group === current} centre={at(node.x, node.y)} radius={HALF[node.shape][0] * scale} beside={node.y > CANVAS_GROUP_TOP} /> : null) : null}
      </Camera>
      {rects.canvas ? <ModelChip t={t} canvas={rects.canvas} /> : null}
    </StageProviders>
  );
}

// A ring around a lit shape: it lands with a pulse, glows while its model is being named, then rests,
// with the model's short name above it
function NodeGlow({ t, group, current, centre, radius, beside }: { t: number; group: ModelGroup; current: boolean; centre: { x: number; y: number }; radius: number; beside: boolean }) {
  const since = t - groupAt(group);
  const land = easeOut(seg(since, 0, 0.45));
  const ring = radius + 7;
  const size = ring * (1.5 - 0.5 * land);
  const tone = TONE[group];
  return <>
    <div aria-hidden style={{
      position: "absolute", left: centre.x - size, top: centre.y - size, width: size * 2, height: size * 2, borderRadius: "50%", pointerEvents: "none", zIndex: 998,
      border: `2px solid ${tone}`, opacity: land * (current ? 1 : 0.55),
      boxShadow: current ? `0 0 18px 4px ${tone}99, inset 0 0 10px ${tone}55` : "none",
    }} />
    <span aria-hidden style={{
      position: "absolute", left: beside ? centre.x + ring + 6 : centre.x, top: beside ? centre.y : centre.y - ring - 7, transform: beside ? "translateY(-50%)" : "translate(-50%, -100%)", pointerEvents: "none", zIndex: 998,
      padding: "1px 6px", borderRadius: 999, background: tone, color: "#0b0b0b", fontSize: 10, fontWeight: 600, lineHeight: "14px", whiteSpace: "nowrap",
      opacity: seg(since, 0.15, 0.45) * (current ? 1 : 0.7),
    }}>{SHORT[group]}</span>
  </>;
}

// The model being named, pinned beside the canvas heading: a dot in the group's colour, the model and its job
function ModelChip({ t, canvas }: { t: number; canvas: FrameRect }) {
  const entries = MODEL_GROUPS.map((entry, index) => {
    const next = MODEL_GROUPS[index + 1]?.at ?? Infinity;
    const opacity = seg(t, entry.at, entry.at + 0.35) * (1 - seg(t, next - 0.25, next));
    return { ...entry, opacity };
  }).filter((entry) => entry.opacity > 0);
  return <>{entries.map((entry) => (
    <div key={entry.group} aria-hidden className="flex items-center gap-3 rounded-full border bg-background/95 py-2 pr-5 pl-3 shadow-lg" style={{
      position: "absolute", right: 1920 - (canvas.x + canvas.w), top: 24, zIndex: 1001, opacity: entry.opacity,
      transform: `translateY(${(1 - easeOut(seg(t, entry.at, entry.at + 0.35))) * 8}px)`, borderColor: `${TONE[entry.group]}88`,
    }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: TONE[entry.group], boxShadow: `0 0 10px ${TONE[entry.group]}` }} />
      <span className="flex flex-col leading-tight">
        <span className="text-base font-semibold">{entry.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{MODEL_IDS[entry.group]}</span>
      </span>
      <span className="ml-2 text-panel text-muted-foreground">{entry.does}</span>
    </div>
  ))}</>;
}

export const models: Scene = { duration: 17.4, Component: Models, title: "Nemotron roles" };
