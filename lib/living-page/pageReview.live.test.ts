import { expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { runPageReview } from "./runPageReview";
import type { DbRpc } from "@/lib/db/rpc";
import type { PageReviewSnapshot } from "./pageReview";

// Explicit opt-in: uses the configured provider and real cited evidence, but never saves edits.
it.skipIf(process.env.LIVE_PAGE_REVIEW !== "1")("rewrites original company-first lead and body using the real reviewer", async () => {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
  const pageId = "9b684190-bbf6-4044-a1d0-ef3e69918346";
  const { data: current, error } = await client.rpc("page_review_snapshot", { p_page_id: pageId });
  if (error) throw error;
  const snapshot = structuredClone(current) as PageReviewSnapshot;
  const originals = [
    ["df24e437-a8b9-4c49-88d0-a33cf297dc38", "Utilitek Solutions Inc. communicates about safety through weekly safety meetings and documented daily tailgate meetings at job sites."],
    ["d71826e9-63e2-49d1-b004-926aaf9a42dd", "Utilitek Solutions Inc. holds regular safety meetings every week so that all employees have an opportunity to receive safety training and voice personal opinions regarding safety. A tailgate meeting is documented at the beginning of each workday when two or more employees, subcontractor representatives, or client representatives are present at a job site, and late arrivals are briefed on the topics and sign the form."],
  ];
  for (const [id, text] of originals) snapshot.lines.find((line) => line.line_id === id)!.content = text!;
  const { data: settings, error: settingsError } = await client.rpc("get_workspace_settings");
  if (settingsError) throw settingsError;
  let relatedRead = false;
  let saved: Record<string, unknown> | undefined;
  const db = { call: async (name: string, args: Record<string, unknown>) => {
    if (name === "page_review_snapshot") return snapshot;
    if (name === "page_review_related" || name === "similar_units") {
      if (name === "page_review_related") relatedRead = true;
      const { data, error } = await client.rpc(name, args);
      if (error) throw error;
      return data;
    }
    if (name !== "complete_page_review") throw new Error(`Unexpected write/call: ${name}`);
    saved = args;
    return { summary: "Dry run", edits: (args.p_edits as unknown[]).length, exceptions: 0, changeSetId: null };
  } } as DbRpc;
  const start = Date.now();
  await runPageReview(db, { apiKey: process.env.NEBIUS_API_KEY!, model: settings.aiModel }, pageId, embedderFromEnv());
  expect(relatedRead, "Full related-knowledge retrieval must succeed").toBe(true);
  const edits = saved!.p_edits as { targetId: string; text: string }[];
  console.info("LIVE REVIEW RESULT", JSON.stringify({ durationMs: Date.now() - start, edits, summary: (saved!.p_review as { summary: string }).summary }));
  for (const [id] of originals) {
    const edit = edits.find((item) => item.targetId === id);
    expect(edit, `Reviewer must rewrite ${id}`).toBeDefined();
    expect(edit!.text).not.toMatch(/^(?:At\s+)?Utilitek Solutions Inc\./i);
  }
  const body = edits.find((item) => item.targetId === originals[1]![0])!.text;
  expect(body).toMatch(/weekly|every week/i);
  expect(body).toMatch(/training/i);
  expect(body).toMatch(/opportunity|chance/i);
  expect(body).toMatch(/opinions|views|concerns|input/i);
  expect(body).toMatch(/two or more|at least two/i);
  expect(body).toMatch(/subcontractor/i);
  expect(body).toMatch(/client/i);
  expect(body).toMatch(/late/i);
  expect(body).toMatch(/sign/i);
}, 180000);
