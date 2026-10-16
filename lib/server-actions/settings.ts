"use server";

import { currentActor } from "@/lib/auth/currentPerson";
import { requireUser } from "@/lib/auth/requireUser";
import { listAvailableModels, saveAiEffort, saveAllowExternalKnowledge, saveArticleCharter, saveAutoUpdateStale, saveChosenModel, saveRoleAuto, saveRoleEffort, saveRoleModel } from "@/lib/ai/models";
import { REASONING_EFFORTS, type ReasoningEffort } from "@/lib/ai/chat";
import { AUTO_ROLES, type AutoRole, MODEL_ROLES, type ModelRole, ROLE_INPUTS, roleName } from "@/lib/ai/roles";
import { describeTypes, missingTypes, type OfferedModel } from "@/lib/ai/modelInputs";
import { runAndRecordSpeedTest, type StoredSpeedTest } from "@/lib/ai/speedTest";
import type { AiCallLogger } from "@/lib/ai/callLog";
import { type ArticleCharter, CHARTER_FIELD_MAX, readCharter } from "@/lib/living-page/articleCharter";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// SETTINGS ACTIONS (called by /settings): the signed-in user's name and
// password, and the workspace's AI model.
// =====================================================================

// PASSWORD: sets a new password for the signed-in user (Supabase Auth checks its own rules)
export async function changePassword(password: string, confirmation: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (!password) throw new Error("Type a new password.");
    if (password !== confirmation) throw new Error("The two passwords don't match.");
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    return {};
  });
}

// NAME: what changes show as "Proposed by"; empty goes back to the email
export async function setMyName(name: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { personId } = await currentActor();
    if (!personId) throw new Error("Not signed in.");
    if (name.trim().length > 80) throw new Error("Keep the name under 80 characters.");
    await supabaseRpc(getAdminSupabase()).call("set_profile_name", { p_person_id: personId, p_name: name });
    return {};
  });
}

// MODEL: saves the picked model after checking Token Factory still offers it; null goes back to the default
export async function chooseModel(model: string | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (model) await requireOfferedModel(model);
    await saveChosenModel(supabaseRpc(getAdminSupabase()), model);
    return {};
  });
}

// ROLE MODEL: runs one AI role on its own model (fast, smart or cheap); null puts it back on the workspace model
export async function chooseRoleModel(role: ModelRole, model: string | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (!MODEL_ROLES.includes(role)) throw new Error(`Unknown AI role "${role}".`);
    if (model) {
      // A role's model must read the data the role sends it (the Media analyst sends images)
      const missing = missingTypes((await requireOfferedModel(model)).inputs, ROLE_INPUTS[role]);
      if (missing.length) throw new Error(`${model} cannot read ${describeTypes(missing).toLowerCase()}, which the ${roleName(role)} sends.`);
    }
    await saveRoleModel(supabaseRpc(getAdminSupabase()), role, model);
    return {};
  });
}

// FULL AUTO: a role that can hold changes in Exceptions has them accepted at once instead (Roles tab)
export async function setRoleAuto(role: AutoRole, on: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (!AUTO_ROLES.includes(role)) throw new Error(`The ${roleName(role)} raises no Exceptions.`);
    await saveRoleAuto(supabaseRpc(getAdminSupabase()), role, on);
    return {};
  });
}

// EFFORT: how hard AI calls think by default; null goes back to the built-in default (medium)
export async function chooseAiEffort(effort: ReasoningEffort | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (effort && !REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown reasoning effort "${effort}".`);
    await saveAiEffort(supabaseRpc(getAdminSupabase()), effort);
    return {};
  });
}

// ROLE EFFORT: one AI role starts at its own reasoning effort; null puts it back on the default effort
export async function chooseRoleEffort(role: ModelRole, effort: ReasoningEffort | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (!MODEL_ROLES.includes(role)) throw new Error(`Unknown AI role "${role}".`);
    if (effort && !REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown reasoning effort "${effort}".`);
    await saveRoleEffort(supabaseRpc(getAdminSupabase()), role, effort);
    return {};
  });
}

// STALE LINES: on rewrites them when an article opens; off waits for Update
export async function setAutoUpdateStale(enabled: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await saveAutoUpdateStale(supabaseRpc(getAdminSupabase()), enabled);
    return {};
  });
}

// EXTERNAL KNOWLEDGE: lets Force Create search the web and store what it finds as external sources
export async function setAllowExternalKnowledge(enabled: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await saveAllowExternalKnowledge(supabaseRpc(getAdminSupabase()), enabled);
    return {};
  });
}

// ARTICLE CHARTER: what the wiki is for, so the Article Reviewer can judge which subjects earn a page
export async function setArticleCharter(charter: ArticleCharter): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const clean = readCharter(charter);
    if (Object.values(clean).some((text) => text.length > CHARTER_FIELD_MAX)) throw new Error(`Keep each field under ${CHARTER_FIELD_MAX} characters.`);
    await saveArticleCharter(supabaseRpc(getAdminSupabase()), clean);
    return {};
  });
}

// Refuses a model id the live list does not have (a typo would fail every upload)
async function requireOfferedModel(model: string): Promise<OfferedModel> {
  const nebiusKey = process.env.NEBIUS_API_KEY;
  if (!nebiusKey) throw new Error("NEBIUS_API_KEY is not set, so there is no model list to pick from.");
  const offered = (await listAvailableModels(nebiusKey)).find((entry) => entry.id === model);
  if (!offered) throw new Error(`No connected AI provider offers "${model}".`);
  return offered;
}

// AI SPEED: times one short streamed answer from a model (latency to the first token, tokens per second after it)
// and stores it. No check against the live model list: Test all runs every model at once, and an id no
// provider offers simply comes back as a failed run.
export async function testModelSpeed(model: string, effort: ReasoningEffort): Promise<ActionResult<{ test: StoredSpeedTest }>> {
  return toActionResult(async () => {
    await requireUser();
    if (!model.trim()) throw new Error("Pick a model to test.");
    if (!REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown reasoning effort "${effort}".`);
    const db = supabaseRpc(getAdminSupabase());
    const logCall: AiCallLogger = (call) => db.call("log_ai_call", { p_call: call });
    return { test: await runAndRecordSpeedTest(db, model, effort, logCall) };
  });
}
