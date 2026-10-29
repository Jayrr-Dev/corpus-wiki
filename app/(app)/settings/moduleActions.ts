"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { isModuleKey, type ModuleKey, setModuleEnabled } from "@/lib/modules";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";

// MODULES: turns Study, Video or Docs on or off for the space (off by default); turning one off keeps its data
export async function setModuleSwitch(key: ModuleKey, on: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (!isModuleKey(key)) throw new Error(`Unknown module "${String(key)}".`);
    await setModuleEnabled(key, on === true);
    return {};
  });
}
