"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { runPageReview, type PageReviewStatus } from "@/lib/living-page/runPageReview";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { toActionResult } from "./result";
import { REVIEW_PROGRESS_EVENT, reviewProgressChannel } from "@/lib/living-page/reviewProgress";
import { getServerDeps } from "@/lib/server/deps";

export async function reviewPage(pageId: string, runId?: string) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(pageId);
    if (runId) z.uuid().parse(runId);
    const db = supabaseRpc(getAdminSupabase());
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "reviewer" } }));
    if (!settings) throw new Error("Configure an AI provider in Settings before reviewing pages.");
    const admin = getAdminSupabase();
    const channel = runId ? admin.channel(reviewProgressChannel(runId)) : null;
    let seq = 0;
    const pending = new Set<Promise<unknown>>();
    const progress = channel ? (detail: string) => {
      const sending = channel.httpSend(REVIEW_PROGRESS_EVENT, { seq: ++seq, detail }).catch(() => undefined);
      pending.add(sending);
      void sending.finally(() => pending.delete(sending));
    } : undefined;
    try {
      const { writer } = await getServerDeps();
      return await runPageReview(db, settings, pageId, embedderFromEnv(process.env, settings.logCall), progress, undefined, { client: admin, writer });
    } finally {
      await Promise.allSettled([...pending]);
      if (channel) await admin.removeChannel(channel);
    }
  });
}

export async function readPageReviewStatus(pageId: string): Promise<PageReviewStatus> {
  await requireUser();
  z.uuid().parse(pageId);
  return supabaseRpc(getAdminSupabase()).call<PageReviewStatus>("page_review_status", { p_page_id: pageId });
}
