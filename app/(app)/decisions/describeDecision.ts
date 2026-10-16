import type { Json, Tables } from "@/lib/database/types";
import { roleName } from "@/lib/ai/roles";
import { modelName } from "../_lib/format";

export function jsonObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
export function roleLabel(value: Json | undefined): string | null {
  const actor = jsonObject(value);
  if (typeof actor.role !== "string") return null;
  return `${roleName(actor.role)} (${typeof actor.model === "string" ? modelName(actor.model) : "model not recorded"})`;
}
export function decisionOutcome(change: Pick<Tables<"change_sets">, "status">, input: Json | undefined): string {
  if (change.status === "reverted") return "Reverted";
  const action = jsonObject(input);
  if (action.revertedAt) return "Reverted";
  if (action.outcome === "approved") return "Approved";
  if (action.outcome === "rejected") return "Rejected";
  if (action.outcome === "error") return "Error";
  if (action.operation === "Archived") return "Archived";
  if (action.operation === "Restored") return "Restored";
  if (action.operation === "Reinstated") return "Reinstated";
  return "Pending";
}
export function roleForAction(type: string | undefined): string | null {
  if (!type) return null;
  if (["write_line", "revise_line", "retire_line", "move_line"].includes(type)) return "write_articles";
  if (["create_page", "create_section", "rename_section", "rename_page"].includes(type)) return "plan_articles";
  if (["add_claim", "revise_claim"].includes(type)) return "extract_knowledge";
  return null;
}
