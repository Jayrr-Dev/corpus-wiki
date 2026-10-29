import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";

type Settings = { aiRoleModels: Record<string, string>; aiRoleEfforts: Record<string, string> };

it("switches Study, Video and Docs with app-wide feature flags, off by default", async () => {
  const { pg, db } = await portablePostgres();
  try {
    expect(await db.call<Record<string, boolean>>("get_feature_flags")).toEqual({});
    await db.call("set_feature_flag", { p_key: "study", p_enabled: true });
    await db.call("set_feature_flag", { p_key: "docs", p_enabled: true });
    await db.call("set_feature_flag", { p_key: "docs", p_enabled: false });
    expect(await db.call<Record<string, boolean>>("get_feature_flags")).toEqual({ study: true, docs: false });
  } finally { await pg.close(); }
});

it("registers the Tutor, Narrator and Docs writer roles", async () => {
  const { pg, db } = await portablePostgres();
  try {
    for (const role of ["tutor", "narrator", "docs_writer"]) {
      await db.call("set_ai_role_model", { p_role: role, p_model: "test-model" });
      await db.call("set_ai_role_effort", { p_role: role, p_effort: "low" });
      await db.call("save_ai_role_instructions", { p_role: role, p_instructions: "Be brief.", p_expected_version: null });
    }
    const settings = await db.call<Settings>("get_workspace_settings");
    expect(settings.aiRoleModels).toMatchObject({ tutor: "test-model", narrator: "test-model", docs_writer: "test-model" });
    expect(settings.aiRoleEfforts).toMatchObject({ tutor: "low", narrator: "low", docs_writer: "low" });
  } finally { await pg.close(); }
});
