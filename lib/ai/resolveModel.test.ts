import { describe, expect, it } from "vitest";
import { resolveModel, tokenFactoryFromEnv } from "./chat";
import { CEREBRAS_BASE_URL, DEFAULT_AI_MODEL, ROLE_DEFAULT_MODELS } from "./config";

// MODEL ORDER: the pick on /settings, then AI_MODEL, then the Nemotron default
describe("resolveModel", () => {
  it("routes OpenRouter models with their own key without requiring Nebius", () => {
    const settings = tokenFactoryFromEnv({ NODE_ENV: "test", OPENROUTER_API_KEY: "router" } as NodeJS.ProcessEnv, "openrouter/anthropic/claude-sonnet-4");
    expect(settings).toMatchObject({ apiKey: "router", model: "openrouter/anthropic/claude-sonnet-4", baseUrl: "https://openrouter.ai/api/v1/" });
    expect(() => tokenFactoryFromEnv({ NODE_ENV: "test", NEBIUS_API_KEY: "n" } as NodeJS.ProcessEnv, "openrouter/example/model")).toThrow("OPENROUTER_API_KEY");
  });
  const env = { AI_MODEL: "zai-org/GLM-5.3" } as unknown as NodeJS.ProcessEnv;

  it("uses the model picked on /settings first", () => {
    expect(resolveModel("nvidia/Nemotron-3-Ultra-550b-a55b", env)).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
  });

  it("falls back to AI_MODEL, then the default", () => {
    expect(resolveModel(null, env)).toBe("zai-org/GLM-5.3");
    expect(resolveModel(null, {} as NodeJS.ProcessEnv)).toBe(DEFAULT_AI_MODEL);
  });

  it("passes the pick into the Token Factory settings", () => {
    const settings = tokenFactoryFromEnv({ NEBIUS_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, "openai/gpt-oss-120b");
    expect(settings?.model).toBe("openai/gpt-oss-120b");
  });

  // ROLE DEFAULTS: Nemotron first, only when nothing is picked; any pick wins
  it("gives each role its Nemotron-first default when nothing is picked", () => {
    const settings = tokenFactoryFromEnv({ NEBIUS_API_KEY: "n" } as unknown as NodeJS.ProcessEnv);
    expect(settings?.roleRoutes?.plan_articles?.model).toBe(ROLE_DEFAULT_MODELS.plan_articles);
    expect(settings?.roleRoutes?.media_analyst?.model).toBe("nvidia/Nemotron-3.5-Super-VL");
    expect(settings?.model).toBe(DEFAULT_AI_MODEL);
  });

  it("keeps a role's own pick and skips the defaults once a model is picked", () => {
    const env = { NEBIUS_API_KEY: "n" } as unknown as NodeJS.ProcessEnv;
    expect(tokenFactoryFromEnv(env, { model: null, roleModels: { curator: "zai-org/GLM-5.3" } })?.roleRoutes?.curator?.model).toBe("zai-org/GLM-5.3");
    expect(tokenFactoryFromEnv(env, "zai-org/GLM-5.3")?.roleRoutes).toBeUndefined();
    expect(tokenFactoryFromEnv({ ...env, AI_MODEL: "zai-org/GLM-5.3" } as NodeJS.ProcessEnv)?.roleRoutes).toBeUndefined();
  });

  it("sends a cerebras/ pick to Cerebras with its own key", () => {
    const env = { NEBIUS_API_KEY: "n", CEREBRAS_API_KEY: "c" } as unknown as NodeJS.ProcessEnv;
    const settings = tokenFactoryFromEnv(env, "cerebras/gpt-oss-120b");
    expect(settings).toMatchObject({ apiKey: "c", model: "cerebras/gpt-oss-120b", baseUrl: CEREBRAS_BASE_URL });
    expect(() => tokenFactoryFromEnv({ NEBIUS_API_KEY: "n" } as unknown as NodeJS.ProcessEnv, "cerebras/gpt-oss-120b")).toThrow(/CEREBRAS_API_KEY/);
  });

  it("sends an anthropic/ pick to Claude with its own key", () => {
    const env = { NEBIUS_API_KEY: "n", ANTHROPIC_API_KEY: "a" } as unknown as NodeJS.ProcessEnv;
    const settings = tokenFactoryFromEnv(env, "anthropic/claude-opus-5-5");
    expect(settings).toMatchObject({ apiKey: "a", model: "anthropic/claude-opus-5-5" });
    expect(() => tokenFactoryFromEnv({ NEBIUS_API_KEY: "n" } as unknown as NodeJS.ProcessEnv, "anthropic/claude-opus-5-5")).toThrow(/ANTHROPIC_API_KEY/);
  });
});
