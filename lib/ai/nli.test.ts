import { afterEach, describe, expect, it, vi } from "vitest";

const fromPretrained = vi.hoisted(() => vi.fn());
vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: { from_pretrained: fromPretrained },
  AutoModelForSequenceClassification: { from_pretrained: fromPretrained },
  env: {},
}));

// Fresh module and process state per test: the model is cached on globalThis
async function nli() {
  vi.resetModules();
  delete (globalThis as { __nli?: unknown }).__nli;
  return import("./nli");
}

afterEach(() => { fromPretrained.mockReset(); vi.restoreAllMocks(); });

describe("getNli", () => {
  it("is on by default and off with DEDUP_NLI=off", async () => {
    const { getNli } = await nli();
    expect(getNli({ NODE_ENV: "production" })?.model).toBe("cross-encoder/nli-deberta-v3-base");
    expect(getNli({ NODE_ENV: "development" })?.model).toBe("cross-encoder/nli-deberta-v3-base");
    expect(getNli({ NODE_ENV: "production", DEDUP_NLI: "off" })).toBeNull();
  });

  it("is off in tests unless DEDUP_NLI=on, so tests never download the model", async () => {
    const { getNli } = await nli();
    expect(getNli({ NODE_ENV: "test" })).toBeNull();
    expect(getNli({ NODE_ENV: "test", DEDUP_NLI: "off" })).toBeNull();
    expect(getNli({ NODE_ENV: "test", DEDUP_NLI: "on" })?.model).toBe("cross-encoder/nli-deberta-v3-base");
  });

  it("does not load the model until the first score", async () => {
    const { getNli } = await nli();
    getNli({ NODE_ENV: "test", DEDUP_NLI: "on" });
    expect(fromPretrained).not.toHaveBeenCalled();
  });

  it("softmaxes the logits into labels from the model config, loading once", async () => {
    const tokenizer = vi.fn(() => ({ input_ids: [] }));
    // This config orders the labels differently from the default, to prove it is read
    const model = Object.assign(vi.fn(async () => ({ logits: { data: new Float32Array([Math.log(6), Math.log(3), Math.log(1)]) } })), { config: { id2label: { 0: "ENTAILMENT", 1: "NEUTRAL", 2: "CONTRADICTION" } } });
    fromPretrained.mockResolvedValueOnce(tokenizer).mockResolvedValueOnce(model);
    const scorer = (await nli()).getNli({ NODE_ENV: "test", DEDUP_NLI: "on" })!;
    const scores = await scorer.score("premise", "hypothesis");
    expect(scores.entailment).toBeCloseTo(0.6);
    expect(scores.neutral).toBeCloseTo(0.3);
    expect(scores.contradiction).toBeCloseTo(0.1);
    expect(tokenizer).toHaveBeenCalledWith("premise", { text_pair: "hypothesis", truncation: true });
    await scorer.score("again", "again");
    expect(fromPretrained).toHaveBeenCalledTimes(2);
    expect(fromPretrained).toHaveBeenLastCalledWith("cross-encoder/nli-deberta-v3-base", { dtype: "fp32", model_file_name: "model_quint8_avx2" });
  });

  it("never throws: a load failure logs once, gives no verdict and turns NLI off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fromPretrained.mockRejectedValue(new Error("offline"));
    const { getNli } = await nli();
    const scorer = getNli({ NODE_ENV: "test", DEDUP_NLI: "on" })!;
    expect(await scorer.score("a", "b")).toEqual({ entailment: 0, contradiction: 0, neutral: 0 });
    expect(await scorer.score("a", "b")).toEqual({ entailment: 0, contradiction: 0, neutral: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getNli({ NODE_ENV: "test", DEDUP_NLI: "on" })).toBeNull();
  });
});
