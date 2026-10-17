import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { generateOpenRouterImage, generateOpenRouterVector } from "@/lib/ai/openrouterImages";
import { supabaseRpc } from "@/lib/db/rpc";
import type { ComposerArticle, ComposerAsset, Composition } from "./compose";
import type { ChatTool } from "@/lib/ai/chat";
import { z } from "zod";

// A caption retry reuses its image instead of repeating paid generation.
export function composerImageGenerator(pageId: string, generate = generateOpenRouterImage, generateVector = generateOpenRouterVector, guard: () => Promise<void> = async () => {}) {
  const created: string[] = [];
  const cache = new Map<string, ComposerAsset>();
  const attempted = new Set<string>();
  const media = new Map<string, boolean>();
  const generator = {
    created,
    async prepare(composition: Composition, article: ComposerArticle, vector = false) {
      for (const f of composition.figures) {
        if (!f.generationPrompt) continue;
        let asset = cache.get(f.after);
        if (asset && media.get(f.after) !== vector) throw new Error("This paragraph already has a generated image. Reuse it or retry explicitly with the other tool.");
        if (!asset) {
          if (attempted.has(f.after)) throw new Error("Image generation was already attempted for this paragraph. Retry the request explicitly if needed.");
          if (attempted.size >= (article.newFigureBudget ?? 3)) throw new Error("This request has reached its image generation limit.");
          await guard();
          attempted.add(f.after);
          const prompt = `${f.generationPrompt}\nProfessional editorial illustration. No words, logos, watermarks, invented measurements or work procedures. Generic conceptual scene, not documentary evidence.`;
          const image = vector ? await generateVector(prompt) : await generate(prompt);
          const client = getAdminSupabase();
          const id = randomUUID(), path = `${id}.${image.extension}`;
          if (!vector) {
            const upload = await client.storage.from("composer-images").upload(path, image.bytes, { contentType: image.mime, upsert: false });
            if (upload.error) throw new Error("Could not save the generated image.");
          }
          const description = f.caption.includes("AI-generated") ? f.caption : `AI-generated illustration. ${f.caption}`;
          const saved = await client.from("assets").insert({ id, kind: "image", origin: "generated", generated_by: "Composer", generated_page_id: pageId,
            storage_path: vector ? `generated/vector/${path}` : `composer-images/${path}`, mime_type: image.mime, media_url: `/api/assets/${id}/${vector ? "vector" : "image"}`, title: f.learningGoal.slice(0,200), description,
            tags: ["illustration", "ai-generated", ...(vector ? ["vector"] : [])], asset_type: "drawing", described_at: new Date().toISOString(), deleted_at: new Date().toISOString(), model: image.model,
            attribution: "Generated through OpenRouter for this workspace.", license: "AI-generated illustration; not documentary evidence." });
          if (saved.error) { if (!vector) await client.storage.from("composer-images").remove([path]); throw new Error("Could not add the generated image to Assets."); }
          if (vector) await supabaseRpc(client).call("store_generated_vector", { p_asset_id: id, p_svg: image.bytes.toString("utf8"), p_caption: description });
          created.push(id);
          asset = { id, title: f.learningGoal, description, type: "drawing", tags: ["illustration"], origin: "generated", attribution: "OpenRouter", license: "AI-generated illustration" };
          cache.set(f.after, asset);
          media.set(f.after, vector);
        }
        article.availableAssets ??= [];
        if (!article.availableAssets.some((a) => a.id === asset.id)) article.availableAssets.push(asset);
        f.assetId = asset.id; f.assetType = "drawing"; f.svg = "";
        if (!f.caption.includes("AI-generated")) f.caption = `AI-generated illustration. ${f.caption}`;
        delete f.generationPrompt;
      }
      return composition;
    },
    async publish(ids: string[]) {
      if (!ids.length) return;
      const { error } = await getAdminSupabase().from("assets").update({ deleted_at: null }).in("id", ids);
      if (error) throw new Error("Could not publish generated assets.");
    },
    async hide(ids: string[]) {
      if (ids.length) await getAdminSupabase().from("assets").update({ deleted_at: new Date().toISOString() }).in("id", ids);
    },
  };
  return { ...generator, tool(article: ComposerArticle, vector = false): ChatTool {
    const schema = z.object({ after: z.string(), prompt: z.string().min(1).max(2000), description: z.string().min(1).max(200) });
    return {
      name: vector ? "generate_vector_image" : "generate_image",
      description: vector ? "Create original scalable SVG vector artwork with Recraft V4.1 Pro Vector: polished editorial illustrations, simple silhouettes and conceptual graphics. Use an existing asset or hand-authored SVG for exact measured diagrams, labels and authentic logos. Costs more than raster generation; use when scalable vector artwork materially benefits the section. Returns a real asset id. Shares the image generation budget." : "Generate one original editorial raster image using the configured OpenRouter image model. Use only when a new illustration improves the section and no suitable asset exists. Do not generate logos or precise engineering diagrams. Returns a real reusable asset id. One generation per paragraph, within the article budget.",
      parameters: z.toJSONSchema(schema),
      async run(input: unknown) {
        const args = schema.parse(input);
        const paragraph = article.paragraphs.find((p) => p.id === args.after);
        if (!paragraph || article.manualPlacementIds && !article.manualPlacementIds.includes(args.after) || article.selectedSections && !article.selectedSections.includes(paragraph.section ?? "Article")) throw new Error("Image generation is restricted to the selected section.");
        const composition = await generator.prepare({ figures: [{ after: args.after, evidence: [args.after], svg: "", generationPrompt: args.prompt, caption: "AI-generated editorial illustration; not documentary evidence.", alt: args.description, learningGoal: args.description }], omitted: "" }, article, vector);
        return { assetId: composition.figures[0]!.assetId, description: args.description, origin: "generated", instruction: "Use this assetId with svg empty. Caption it as an AI-generated illustration." };
      },
    };
  } };
}
