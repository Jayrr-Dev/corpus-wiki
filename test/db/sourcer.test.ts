import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";
it("registers Sourcer instructions, model and effort", async () => {
  const { pg, db } = await portablePostgres();
  try {
    await db.call("save_ai_role_instructions", { p_role: "sourcer", p_instructions: "Find primary sources.", p_expected_version: null });
    expect(await db.call("get_ai_role_instructions")).toEqual(expect.arrayContaining([expect.objectContaining({ role: "sourcer", instructions: "Find primary sources." })]));
    await db.call("set_ai_role_model", { p_role: "sourcer", p_model: "test-model" });
    await db.call("set_ai_role_effort", { p_role: "sourcer", p_effort: "low" });
    const settings = await db.call<{ aiRoleModels: Record<string, string>; aiRoleEfforts: Record<string, string> }>("get_workspace_settings");
    expect(settings.aiRoleModels.sourcer).toBe("test-model");
    expect(settings.aiRoleEfforts.sourcer).toBe("low");
  } finally { await pg.close(); }
});
