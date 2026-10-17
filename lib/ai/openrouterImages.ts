import "server-only";
import { OPENROUTER_BASE_URL } from "./openrouterConfig";
import { validateVectorSvg } from "@/lib/composer/vectorSvg";

export type ImageModel = { id: string; name?: string; architecture?: { output_modalities?: string[] } };
export async function listImageModels(request: typeof fetch = fetch): Promise<ImageModel[]> {
  const response = await request(new URL("images/models", OPENROUTER_BASE_URL), { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`OpenRouter image catalogue unavailable (${response.status}).`);
  const body = await response.json() as { data?: ImageModel[] };
  return (body.data ?? []).filter((m) => m.architecture?.output_modalities?.includes("image"));
}

async function requestImage(prompt: string, model: string, env: NodeJS.ProcessEnv, request: typeof fetch, vector = false) {
  if (!env.OPENROUTER_API_KEY) throw new Error("Add OPENROUTER_API_KEY to the server environment to generate images.");
  if (!prompt.trim() || prompt.length > 4000) throw new Error("Give image generation a prompt of 1–4000 characters.");
  if (!(await listImageModels(request)).some((m) => m.id === model)) throw new Error(`OpenRouter does not currently list image model “${model}”. Set ${vector ? "OPENROUTER_VECTOR_MODEL" : "OPENROUTER_IMAGE_MODEL"} to an available image model.`);
  const response = await request(new URL("images", OPENROUTER_BASE_URL), {
    method: "POST", signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, n: 1, ...(vector ? { output_format: "svg" } : {}) }),
  });
  // Keep provider bodies out of errors: they may contain prompts or other private data.
  if (!response.ok) throw new Error(response.status === 401 ? "OpenRouter rejected the API key." : response.status === 402 ? "OpenRouter needs credits before it can generate an image." : `OpenRouter image generation failed (${response.status}).`);
  const body = await response.json() as { data?: { b64_json?: string; media_type?: string }[]; usage?: { cost?: number } };
  const raw = body.data?.[0]?.b64_json;
  if (!raw || raw.length > 28_000_000 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(raw)) throw new Error("OpenRouter did not return a usable image.");
  const bytes = Buffer.from(raw, "base64");
  return { bytes, model, cost: body.usage?.cost ?? null };
}

export async function generateOpenRouterImage(prompt: string, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const { bytes, model, cost } = await requestImage(prompt, env.OPENROUTER_IMAGE_MODEL || "qwen/qwen-image-2.1-turbo", env, request);
  // Validate bytes rather than trusting the declared MIME. SVG is deliberately excluded.
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP";
  if (!png && !jpeg && !webp) throw new Error("OpenRouter returned an unsupported image format.");
  return { bytes, mime: png ? "image/png" : jpeg ? "image/jpeg" : "image/webp", extension: png ? "png" : jpeg ? "jpg" : "webp", model, cost };
}

export async function generateOpenRouterVector(prompt: string, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const result = await requestImage(prompt, env.OPENROUTER_VECTOR_MODEL || "recraft/recraft-v4.1-pro-vector", env, request, true);
  const svg = result.bytes.toString("utf8");
  const problems = validateVectorSvg(svg);
  if (problems.length) throw new Error(`The vector image failed validation: ${problems.join("; ")}`);
  return { ...result, svg, mime: "image/svg+xml", extension: "svg" };
}
