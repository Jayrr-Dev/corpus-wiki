import { describe, expect, it } from "vitest";
import { resolveModel, tokenFactoryFromEnv } from "./chat";
import { CEREBRAS_BASE_URL, DEFAULT_AI_MODEL } from "./config";

// MODEL ORDER: the pick on /settings, then AI_MODEL, then the Nemotron default
describe("resolveModel", () => {
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

  it("sends a cerebras/ pick to Cerebras with its own key", () => {
    const env = { NEBIUS_API_KEY: "n", CEREBRAS_API_KEY: "c" } as unknown as NodeJS.ProcessEnv;
    const settings = tokenFactoryFromEnv(env, "cerebras/gpt-oss-120b");
    expect(settings).toMatchObject({ apiKey: "c", model: "cerebras/gpt-oss-120b", baseUrl: CEREBRAS_BASE_URL });
    expect(() => tokenFactoryFromEnv({ NEBIUS_API_KEY: "n" } as unknown as NodeJS.ProcessEnv, "cerebras/gpt-oss-120b")).toThrow(/CEREBRAS_API_KEY/);
  });
});
