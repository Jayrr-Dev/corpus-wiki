"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { Check } from "lucide-react";
import type { ModelSettings } from "@/app/(app)/settings/loadModelSettings";
import { RoleModels } from "@/app/(app)/settings/RoleModels";
import { InfoPopover } from "@/components/standard/info-popover";
import { Camera, Cursor, Highlight, interaction, seg, StageProviders, type Scene } from "@/components/video-stage";
import { DEFAULT_AI_MODEL, ROLE_DEFAULT_MODELS } from "@/lib/ai/config";
import { readsAll } from "@/lib/ai/modelInputs";
import { ROLE_INPUTS, roleName } from "@/lib/ai/roles";
import { cn } from "@/lib/utils";
import { MODEL_IDS, PICKER_SWITCH, TOKEN_FACTORY_MODELS } from "@/lib/video-stage/phoenix/control";
import { SettingsFrame } from "./costs";
import { ORIGIN, useElementStyle, useFrameRects } from "./exception";

// =====================================================================
// PICKER: "…and I can switch any of them in settings." Settings,
// Intelligence, Model by role. The cursor opens the Reconciler's model
// picker, the Token Factory list drops down, the cursor picks Nemotron
// Ultra and the row updates. 3.2 seconds.
// =====================================================================

const OPEN = 1.0;
const PICK = 2.2;
const ITEM = 30;

const BEFORE: ModelSettings = {
  chosenModel: null,
  activeModel: DEFAULT_AI_MODEL,
  visionModel: MODEL_IDS.vision,
  roleModels: { ...ROLE_DEFAULT_MODELS },
  roleDefaults: ROLE_DEFAULT_MODELS,
  effort: null,
  roleEfforts: {},
  roleAuto: [],
  models: TOKEN_FACTORY_MODELS.map((model) => model.id),
  modelInputs: Object.fromEntries(TOKEN_FACTORY_MODELS.map((model) => [model.id, model.inputs])),
  listError: null,
};
const AFTER: ModelSettings = { ...BEFORE, roleModels: { ...BEFORE.roleModels, [PICKER_SWITCH.role]: PICKER_SWITCH.to } };

// The options the real select lists for the role (RoleModelControls): its built-in default, then every
// model that reads what the role sends, image readers marked
const NEEDS = ROLE_INPUTS[PICKER_SWITCH.role];
const options = [
  { value: "", label: `Default · ${ROLE_DEFAULT_MODELS[PICKER_SWITCH.role]!.split("/").pop()}` },
  ...BEFORE.models.filter((model) => readsAll(BEFORE.modelInputs[model], NEEDS))
    .map((model) => ({ value: model, label: BEFORE.modelInputs[model]?.includes("image") && !NEEDS.includes("image") ? `${model} · images` : model })),
];

const SELECT = `select[aria-label="Model for ${roleName(PICKER_SWITCH.role)}"]`;

function Picker({ t }: { t: number }) {
  const picked = t >= PICK + 0.06;
  const [origin, rects] = useFrameRects((frame) => {
    const select = frame.querySelector(SELECT);
    return { select, row: select?.closest("li") };
  });
  useElementStyle(() => document.querySelector<HTMLElement>(SELECT)?.parentElement, interaction(t, { hover: [OPEN - 0.25, OPEN + 0.1], click: OPEN }));

  const select = rects.select ?? { x: 1000, y: 400, w: 340, h: 32, cx: 1170, cy: 416 };
  const row = rects.row;
  const listTop = select.y + select.h + 4;
  const target = Math.max(0, options.findIndex((option) => option.value === PICKER_SWITCH.to));
  const itemY = (index: number) => listTop + 4 + index * ITEM + ITEM / 2;
  const open = t >= OPEN + 0.06 && t < PICK + 0.06;
  const grow = seg(t, OPEN + 0.06, OPEN + 0.2);
  // The item under the cursor once it arrives
  const hoverIndex = t >= 1.8 ? target : -1;

  return (
    <StageProviders>
      <Camera t={t} keys={[[0, 1, select.cx, select.cy + 120], [3.2, 1.16, select.cx, select.cy + 120]]}>
        <div ref={origin} style={ORIGIN} />
        <SettingsFrame tab="intelligence" title="Intelligence" description="Fine-tune the AI behind your wiki.">
          <div className="mb-5 flex items-center gap-1.5"><h3 className="font-medium">Model by role</h3><InfoPopover label="About model by role">
            <p>Run a role on its own model: a fast one to write, a smart one to decide and review, a cheap one for routine work.</p>
          </InfoPopover></div>
          <RoleModels settings={picked ? AFTER : BEFORE} />
        </SettingsFrame>
        {open ? (
          <div role="listbox" aria-label="Models" className="absolute z-50 overflow-hidden rounded-lg border bg-popover p-1 text-panel text-popover-foreground shadow-xl"
            style={{ left: select.x, top: listTop, width: Math.max(select.w, 380), opacity: grow, transform: `translateY(${(1 - grow) * -6}px)` }}>
            {options.map((option, index) => (
              <div key={option.value} role="option" aria-selected={option.value === PICKER_SWITCH.from}
                className={cn("flex items-center gap-2 rounded-md px-2 whitespace-nowrap", index === hoverIndex && "bg-accent text-accent-foreground")} style={{ height: ITEM }}>
                <Check className={cn("size-3.5 shrink-0", option.value === PICKER_SWITCH.from ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                <span className="truncate">{option.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        {row ? <Highlight t={t} from={PICK + 0.15} to={3.6} x={row.x} y={row.y} w={row.w} h={row.h} radius={8} pad={2} /> : null}
        <Cursor t={t} path={[[0, select.cx + 380, select.cy + 300], [0.1, select.cx + 370, select.cy + 290], [OPEN - 0.15, select.cx - 40, select.cy + 2], [1.35, select.cx - 40, select.cy + 2], [PICK - 0.25, select.x + 150, itemY(target) + 2], [PICK + 0.1, select.x + 150, itemY(target) + 2], [3.2, select.x + select.w - 70, select.cy + 34]]} clicks={[OPEN, PICK]} />
      </Camera>
    </StageProviders>
  );
}

export const picker: Scene = { duration: 3.2, Component: Picker, title: "Model picker" };
