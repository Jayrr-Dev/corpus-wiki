import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { createPage, updateArticle } from "@/lib/server-actions/pages";
import { startLinkUpload, processUpload } from "@/lib/server-actions/upload";
import { retrieve } from "./retrieve";
import type { AgentTool } from "./agentTools";
import type { DbRpc } from "@/lib/db/rpc";
import type { Embedder } from "@/lib/ai/embeddings";

export async function executeAgentTool(tool: AgentTool, deps: { db: DbRpc; embedder: Embedder; entityId?: string; userText: string }) {
  const client = await getServerSupabase();
  switch (tool.name) {
    case "search": return retrieve(tool.query, deps.db, deps.embedder, deps.entityId);
    case "catalog": {
      const [pages, entities] = await Promise.all([
        client.from("pages").select("id,title,slug,entity_id,context_entity_id").is("retired_at", null).eq("kind", "article").order("title").limit(200),
        client.from("entities").select("id,name,type").is("merged_into_id", null).order("name").limit(200),
      ]);
      if (pages.error) throw pages.error;
      if (entities.error) throw entities.error;
      return { articles: pages.data, entities: entities.data, limit: 200 };
    }
    case "list_exceptions": {
      const result = await client.from("exceptions").select("id,reason,evidence,note,action_id,created_at").eq("status", "open").order("created_at", { ascending: false }).limit(20);
      if (result.error) throw result.error;
      return { exceptions: result.data, href: "/exceptions", limit: 20 };
    }
    case "create_article": {
      if (deps.entityId && deps.entityId !== tool.entityId) throw new Error("Choose this entity as the chat context before creating its article.");
      const entity = await client.from("entities").select("id").eq("id", tool.entityId).is("merged_into_id", null).single();
      if (entity.error) throw entity.error;
      const result = await createPage({ title: tool.title, entityId: tool.entityId });
      if (!result.ok) return result;
      const href = `/p/${result.slug}`;
      if (tool.instructions) {
        const written = await updateArticle({ scope: "page", id: result.pageId, note: tool.instructions });
        if (!written.ok) return { ...result, ok: false, href, error: `The article was created, but the requested rewrite failed: ${written.error}` };
      }
      return { ...result, href };
    }
    case "update_article": {
      const page = await client.from("pages").select("slug,entity_id,context_entity_id").eq("id", tool.pageId).is("retired_at", null).single();
      if (page.error) throw page.error;
      if (deps.entityId && page.data.entity_id !== deps.entityId && page.data.context_entity_id !== deps.entityId) throw new Error("Choose this article's entity as the chat context before updating it.");
      const result = await updateArticle({ scope: "page", id: tool.pageId, note: tool.instructions });
      return result.ok ? { ...result, href: `/p/${page.data.slug}` } : result;
    }
    case "add_source": {
      const urls = deps.userText.match(/https?:\/\/[^\s<>"\]]+/gi) ?? [];
      if (!urls.some(url => {
        try { return new URL(url.replace(/[),.;]+$/, "")).href === new URL(tool.url).href; } catch { return false; }
      })) throw new Error("Ask the user to provide the exact source link before importing it.");
      const started = await startLinkUpload(tool.url, tool.sourceDate);
      if (!started.ok) return started;
      if (started.kind === "skipped") return { ...started, href: `/sources/${started.sourceId}` };
      const processed = await processUpload(started.eventId);
      return { ...started, ...processed, href: `/sources/${started.sourceId}` };
    }
    case "resolve_exception": {
      const exception = await client.from("exceptions").select("id,reason,evidence").eq("id", tool.exceptionId).eq("status", "open").single();
      if (exception.error) throw exception.error;
      return { confirmationRequired: true, decision: tool, exception: exception.data, href: "/exceptions" };
    }
  }
}
