import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";

type Settings = { modules: Record<string, boolean>; aiRoleModels: Record<string, string>; aiRoleEfforts: Record<string, string> };

it("keeps module switches off by default, sets each one alone and rejects unknown modules", async () => {
  const { pg, db } = await portablePostgres();
  try {
    expect((await db.call<Settings>("get_workspace_settings")).modules).toEqual({});
    await db.call("set_module_enabled", { p_module: "study", p_enabled: true });
    await db.call("set_module_enabled", { p_module: "docs", p_enabled: true });
    await db.call("set_module_enabled", { p_module: "docs", p_enabled: false });
    expect((await db.call<Settings>("get_workspace_settings")).modules).toEqual({ study: true, docs: false });
    await expect(db.call("set_module_enabled", { p_module: "billing", p_enabled: true })).rejects.toThrow(/Unknown module/);
    const grants = await pg.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select
      has_function_privilege('anon', 'public.set_module_enabled(text,boolean)', 'execute') anon,
      has_function_privilege('authenticated', 'public.set_module_enabled(text,boolean)', 'execute') authenticated,
      has_function_privilege('service_role', 'public.set_module_enabled(text,boolean)', 'execute') service`);
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service: true });
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
