import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";
it("registers Composer instructions, models and effort without broadening auto approvals", async () => {
  const store = await portablePostgres();
  try {
    await store.db.call("save_ai_role_instructions", { p_role: "composer", p_instructions: "Use useful illustrations.", p_expected_version: null });
    expect(await store.db.call("get_ai_role_instructions")).toEqual(expect.arrayContaining([expect.objectContaining({ role: "composer", instructions: "Use useful illustrations." })]));
    await store.db.call("set_ai_role_model", { p_role: "composer", p_model: "example-model" });
    await store.db.call("set_ai_role_effort", { p_role: "composer", p_effort: "low" });
    const settings = await store.db.call<{ aiRoleModels: Record<string, string>; aiRoleEfforts: Record<string, string> }>("get_workspace_settings");
    expect(settings.aiRoleModels.composer).toBe("example-model");
    expect(settings.aiRoleEfforts.composer).toBe("low");
    await expect(store.db.call("set_ai_role_model", { p_role: "invented", p_model: "example-model" })).rejects.toThrow("Unknown AI role");
    await expect(store.db.call("set_ai_role_auto", { p_role: "composer", p_on: true })).rejects.toThrow("raises no Exceptions");
  } finally { await store.pg.close(); }
});

