import { readFileSync } from "node:fs";
import { it } from "vitest";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { imageDescriberFrom } from "@/lib/ingest/describeMediaServer";
import { readDocx } from "@/lib/ingest/docx";
import { splitIntoPassages } from "@/lib/ingest/passages";

// LIVE CHECK: reads a real .docx with the real vision model; pictures are not stored (fake store).
// RUN_AI_BENCH=1 BENCH_DOCX=<file.docx> node --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/bench/docx-figures.live.test.ts
it.runIf(process.env.RUN_AI_BENCH === "1")("describes a real document's pictures", async () => {
  const started = Date.now();
  const pages = await readDocx(new Uint8Array(readFileSync(process.env.BENCH_DOCX!)), {
    fileName: "document.docx",
    describeImage: imageDescriberFrom(tokenFactoryFromEnv()),
    storeFigure: async (path) => path,
  });
  const passages = splitIntoPassages(pages);
  console.info(`${passages.length} passages in ${Math.round((Date.now() - started) / 1000)}s`);
  for (const p of passages) if (p.location.figure) console.info(`#${p.position} [${p.location.figure.slice(8, 16)}] ${p.text}`);
}, 600_000);
