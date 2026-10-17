import { afterEach, expect, it, vi } from "vitest";
import { generateOpenRouterImage, generateOpenRouterVector } from "./openrouterImages";
afterEach(() => vi.restoreAllMocks());
const env = { NODE_ENV: "test", OPENROUTER_API_KEY: "secret-test-key", OPENROUTER_IMAGE_MODEL: "test/image" } as NodeJS.ProcessEnv;
const catalogue = () => Response.json({ data: [{ id: "test/image", architecture: { output_modalities: ["image"] } }] });
it("uses the separate vector model, requests SVG, and preserves validated vector bytes", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M0 0L10 10"/></svg>';
  const request = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "test/vector", architecture: { output_modalities: ["image"] } }] })).mockResolvedValueOnce(Response.json({ data: [{ b64_json: Buffer.from(svg).toString("base64"), media_type: "image/svg+xml" }] }));
  const result = await generateOpenRouterVector("Vector scene", { ...env, OPENROUTER_VECTOR_MODEL: "test/vector" }, request);
  expect(result.svg).toBe(svg);
  expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ model: "test/vector", prompt: "Vector scene", n: 1, output_format: "svg" });
});
it("requires a key before any request", async () => {
  const request = vi.fn();
  await expect(generateOpenRouterImage("Apple", {} as NodeJS.ProcessEnv, request)).rejects.toThrow("OPENROUTER_API_KEY");
  expect(request).not.toHaveBeenCalled();
});
it("checks the catalogue, sends the configured model and decodes image bytes", async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0]);
  const request = vi.fn().mockResolvedValueOnce(catalogue()).mockResolvedValueOnce(Response.json({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }] }));
  const result = await generateOpenRouterImage("Apple", env, request);
  expect(result.bytes).toEqual(png);
  expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ model: "test/image", prompt: "Apple", n: 1 });
  expect(String(request.mock.calls[1]![0])).toBe("https://openrouter.ai/api/v1/images");
});
it("does not retry paid generation and hides provider error bodies", async () => {
  const request = vi.fn().mockResolvedValueOnce(catalogue()).mockResolvedValueOnce(Response.json({ error: "secret-test-key" }, { status: 402 }));
  await expect(generateOpenRouterImage("Apple", env, request)).rejects.toThrow("needs credits");
  expect(request).toHaveBeenCalledTimes(2);
});
it("rejects executable formats even when the provider labels them PNG", async () => {
  const request = vi.fn().mockResolvedValueOnce(catalogue()).mockResolvedValueOnce(Response.json({ data: [{ b64_json: Buffer.from("<svg><script>bad</script></svg>").toString("base64"), media_type: "image/png" }] }));
  await expect(generateOpenRouterImage("Apple", env, request)).rejects.toThrow("unsupported image format");
});
