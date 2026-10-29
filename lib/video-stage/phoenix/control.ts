import { ROLE_DEFAULT_MODELS } from "@/lib/ai/config";
import type { DataType } from "@/lib/ai/modelInputs";
import type { Tables } from "@/lib/database/types";
import type { UnitSummary } from "@/lib/queries/screens";
import { fakeDate, fakeId, PEOPLE, SOURCES, type PhoenixSource } from "./core";

// =====================================================================
// CONTROL LANE DATA: the rows behind the exception, models, costs and
// picker scenes. One conflict held in Exceptions (the deploy window),
// the Token Factory models the roles run on, and a quarter of AI calls.
// Plain data, no React; all of it fictional.
// =====================================================================

// THE NEWER FILE: April's CAB minutes, which move the deploy window the runbook still states
export const CAB_MINUTES_APRIL: PhoenixSource = {
  key: "cabMinutesApril",
  id: fakeId("source", "cabMinutesApril"),
  kind: "docx",
  title: "CAB-Minutes-2026-04.docx",
  date: "2026-04-08",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  origin: "internal",
  author: "patty",
};

// THE CONFLICT: the runbook says every second Friday, the April minutes say every Thursday after CAB
const UNIT_ID = fakeId("unit", "deploy-window");
const REVISION_ID = fakeId("revision", "deploy-window", 1);
const ACTION_ID = fakeId("action", "deploy-window-thursday");
const EXCEPTION_ID = fakeId("exception", "deploy-window");

export const DEPLOY_WINDOW = {
  current: "Phoenix production releases deploy every second Friday, after the 18:00 freeze.",
  proposed: "Phoenix production releases deploy every Thursday after CAB, after the 18:00 freeze.",
};

export const DEPLOY_UNIT: UnitSummary = {
  id: UNIT_ID,
  created_at: fakeDate("2026-03-02", "10:14"),
  current_revision_id: REVISION_ID,
  epistemic_status: "established",
  kind: "decision",
  last_changed_at: fakeDate("2026-03-02", "10:14"),
  origin: "derived",
  retired_at: null,
  valid_from: fakeDate("2026-03-02"),
  valid_to: null,
  content: DEPLOY_WINDOW.current,
} as UnitSummary;

export const DEPLOY_ACTION: Tables<"actions"> = {
  id: ACTION_ID,
  type: "revise_claim",
  target_id: UNIT_ID,
  input: {
    content: DEPLOY_WINDOW.proposed,
    rationale: `${CAB_MINUTES_APRIL.title} moves the deploy window to Thursdays, the day after CAB approves the change list. ${SOURCES.runbook.title} still says every second Friday. The two files disagree, so the change waits for you.`,
  },
  outcome: "exception",
  change_set_id: fakeId("change-set", "cab-minutes-april"),
  position: 0,
  created_at: fakeDate("2026-04-08", "16:42"),
  applied_at: null,
  after_revision_id: null,
  before_revision_id: null,
  after_line_revision_id: null,
  before_line_revision_id: null,
  expected_revision_id: REVISION_ID,
  check_results: {},
  passage_ids: [fakeId("passage", "cab-minutes-april", 3)],
  reverted_by_event_id: null,
  speech_act: null,
  undo_state: null,
};

export const DEPLOY_EXCEPTION: Tables<"exceptions"> = {
  id: EXCEPTION_ID,
  action_id: ACTION_ID,
  reason: "decision_conflict",
  status: "open",
  created_at: fakeDate("2026-04-08", "16:42"),
  domain_id: null,
  note: null,
  resolved_at: null,
  resolved_by_id: null,
  evidence: {
    detail: `${SOURCES.runbook.title} says every second Friday; ${CAB_MINUTES_APRIL.title} says every Thursday after CAB.`,
    quote: `Effective 9 April, Phoenix production deploys move to Thursdays, the day after CAB approves the change list. Friday releases are retired. (${PEOPLE.patty.name}, chair)`,
  },
};

// THE OTHER INBOX ROWS: answered earlier, so the open tab holds just the one conflict
export const EXCEPTION_COUNTS = { open: 1, answered: 14 };

// THE TOKEN FACTORY MODELS the roles run on, by voice-over group
export const MODEL_IDS = {
  super: "nvidia/nemotron-3-super-120b-a12b",
  ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  vision: "nvidia/Nemotron-3.5-Super-VL",
  flash: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
} as const;

export type ModelGroup = "super" | "ultra" | "nano" | "vision";

// THE MODELS SCENE'S GROUPS: when each lights (seconds from the scene's start, matched to the voice) and its label
export const MODEL_GROUPS: { group: ModelGroup; at: number; name: string; does: string }[] = [
  { group: "super", at: 0.2, name: "Nemotron 3 Super", does: "Everyday writing and fact-checks" },
  { group: "ultra", at: 6.2, name: "Nemotron 3 Ultra", does: "The big calls: articles and the topic tree" },
  { group: "nano", at: 11.2, name: "Nemotron 3 Nano", does: "Bulk linking" },
  { group: "vision", at: 13.0, name: "Nemotron 3.5 Super VL", does: "Screenshots, diagrams and video frames" },
];

// Which group a role's default model belongs to (none for DeepSeek, the duplicate checks)
export function modelGroupOf(role: string | undefined): ModelGroup | null {
  const model = role ? ROLE_DEFAULT_MODELS[role] : undefined;
  const entry = Object.entries(MODEL_IDS).find(([, id]) => id === model);
  return entry && entry[0] !== "flash" ? (entry[0] as ModelGroup) : null;
}

// THE TOKEN FACTORY LIST the picker offers: Nemotron first, as the provider lists them
export const TOKEN_FACTORY_MODELS: { id: string; inputs: DataType[] }[] = [
  { id: MODEL_IDS.super, inputs: ["text"] },
  { id: MODEL_IDS.ultra, inputs: ["text"] },
  { id: MODEL_IDS.nano, inputs: ["text"] },
  { id: "nvidia/Nemotron-3_5-Lightning", inputs: ["text"] },
  { id: "nvidia/Nemotron-3-Nano-Omni", inputs: ["text", "image"] },
  { id: MODEL_IDS.vision, inputs: ["text", "image"] },
  { id: MODEL_IDS.flash, inputs: ["text"] },
  { id: "deepseek-ai/DeepSeek-V4-Pro-0813", inputs: ["text"] },
  { id: "zai-org/GLM-5.3", inputs: ["text"] },
  { id: "moonshotai/Kimi-K2.6", inputs: ["text"] },
  { id: "Qwen/Qwen3.5-397B-A17B", inputs: ["text"] },
  { id: "openai/gpt-oss-120b", inputs: ["text"] },
];

// THE PICKER SCENE'S SWITCH: the Reconciler moves from Super to Ultra
export const PICKER_SWITCH = { role: "reconciler", from: MODEL_IDS.super, to: MODEL_IDS.ultra } as const;

// AI CALLS: one quarter of Parts Unlimited's logged calls per model. Nano does the most calls and
// costs the least; tokens per call vary a little, deterministically, so totals look real.
const CALL_PLAN: { model: string; role: string; calls: number; prompt: number; completion: number }[] = [
  { model: MODEL_IDS.nano, role: "link_knowledge", calls: 3906, prompt: 3000, completion: 420 },
  { model: MODEL_IDS.super, role: "write_articles", calls: 1284, prompt: 6100, completion: 1250 },
  { model: MODEL_IDS.flash, role: "deduplicator", calls: 2410, prompt: 1900, completion: 60 },
  { model: MODEL_IDS.vision, role: "media_analyst", calls: 218, prompt: 4800, completion: 900 },
  { model: MODEL_IDS.ultra, role: "plan_articles", calls: 142, prompt: 14200, completion: 2600 },
];

export function aiCalls(): Tables<"ai_calls">[] {
  const rows: Tables<"ai_calls">[] = [];
  for (const plan of CALL_PLAN) {
    for (let i = 0; i < plan.calls; i++) {
      const wobble = 0.7 + ((i * 37) % 61) / 100;
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = ["2026-07", "2026-08", "2026-09"][i % 3];
      rows.push({
        id: fakeId("ai-call", plan.model, i),
        model: plan.model,
        role: plan.role,
        purpose: plan.role,
        prompt_tokens: Math.round(plan.prompt * wobble),
        completion_tokens: Math.round(plan.completion * wobble),
        reasoning_tokens: null,
        reasoning_effort: null,
        duration_ms: Math.round(900 * wobble),
        status: "ok",
        error: null,
        subject: null,
        created_at: fakeDate(`${month}-${day}`, "10:00"),
      });
    }
  }
  return rows;
}
