import { createServer } from "vite";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": process.cwd(), "server-only": resolve("test/server-only.ts") } } });
try {
  const { generateOpenRouterVector } = await runtime.ssrLoadModule("/lib/ai/openrouterImages.ts");
  const { validateVectorSvg } = await runtime.ssrLoadModule("/lib/composer/vectorSvg.ts");
  const prompt = "Clean professional vector illustration of a city planning team: three people gathered around a table with a simple miniature city model. Restrained muted blue, warm grey and soft orange palette, crisp layered shapes, soft gradients, generous white background, landscape composition, readable at thumbnail size. Friendly credible proportions. No text, labels, logos, numbers, measurements or watermarks. Conceptual editorial illustration, not a real city project.";
  await mkdir("artifacts/composer-live", { recursive: true });
  const request: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (init?.method === "POST" && response.ok) {
      const body = await response.clone().json();
      if (body.data?.[0]?.b64_json) await writeFile("artifacts/composer-live/recraft-vector-quarantine.svg", Buffer.from(body.data[0].b64_json,"base64"));
      await writeFile("artifacts/composer-live/recraft-vector-provider.json", JSON.stringify({ cost: body.usage?.cost ?? null },null,2));
    }
    return response;
  };
  const cached = process.argv.includes("--cached") ? await readFile("artifacts/composer-live/recraft-vector-quarantine.svg") : null;
  if (cached && validateVectorSvg(cached.toString("utf8")).length) throw new Error("Cached vector failed validation.");
  const image = cached ? { bytes: cached, svg: cached.toString("utf8"), mime: "image/svg+xml", model: "recraft/recraft-v4.1-pro-vector", cost: null } : await generateOpenRouterVector(prompt, process.env, request);
  await writeFile("artifacts/composer-live/recraft-vector-test.svg", image.svg);
  await sharp(image.bytes).resize({ width: 1000, withoutEnlargement: true }).png().toFile("artifacts/composer-live/recraft-vector-test.png");
  await writeFile("artifacts/composer-live/recraft-vector-test.json", JSON.stringify({ model: image.model, mime: image.mime, file: "artifacts/composer-live/recraft-vector-test.svg", cost: image.cost, bytes: image.bytes.length, prompt, validationPassed: true },null,2));
  console.log(JSON.stringify({ model: image.model, cost: image.cost, bytes: image.bytes.length, validationPassed: true }));
} finally { await runtime.close(); }
