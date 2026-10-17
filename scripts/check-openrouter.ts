import { createServer } from "vite";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": process.cwd(), "server-only": resolve("test/server-only.ts") } } });
try {
  const { chatJson, tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const schema = z.object({ status: z.literal("ok") });
  const settings = tokenFactoryFromEnv(process.env, "openrouter/openai/gpt-oss-120b");
  const text = await chatJson(settings, { name: "openrouter_connection_check", schema, jsonSchema: z.toJSONSchema(schema), messages: [{ role: "user", content: 'Reply with {"status":"ok"}.' }], maxTokens: 1000 });
  console.log(JSON.stringify({ text: text.value, model: text.model }));
  if (process.argv.includes("--generate")) {
    const { generateOpenRouterImage } = await runtime.ssrLoadModule("/lib/ai/openrouterImages.ts");
    const prompt = "Professional editorial 3D illustration of a small city planning team reviewing a site plan at a table, subtle generic city skyline in background, restrained warm neutral and muted blue palette, realistic proportions, uncluttered composition, soft lighting. No text, labels, brands, logos, measurements or watermarks. Generic conceptual scene, not a real city project.";
    const image = await generateOpenRouterImage(prompt);
    await mkdir("artifacts/composer-live", { recursive: true });
    const file = `artifacts/composer-live/openrouter-${image.model.replace(/[^a-z0-9]/gi, "-")}-test.${image.extension}`;
    await writeFile(file, image.bytes);
    await writeFile(file.replace(/\.[^.]+$/, ".json"), JSON.stringify({ model: image.model, mime: image.mime, bytes: image.bytes.length, cost: image.cost, file, prompt }, null, 2));
    console.log(JSON.stringify({ image: file, model: image.model, bytes: image.bytes.length, cost: image.cost }));
  }
} finally { await runtime.close(); }
