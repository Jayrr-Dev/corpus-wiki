"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { InfoHint } from "@/components/standard/info-hint";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { type CostRates, estimateCost, formatUsd } from "@/lib/video/cost";
import type { ScriptEdit } from "@/lib/video/script";
import { SCENE_VISUAL_LABELS, SCENE_VISUALS, type SceneVisual, type VideoRow } from "@/lib/video/types";
import { makeVideo, rewriteScript, saveScript } from "../actions";
import type { AssetChoice } from "./VideoDetail";

type Draft = { id: string; narration: string; title: string; bullets: string; visual: SceneVisual; assetId: string | null; graphic: string };

const toDrafts = (video: VideoRow): Draft[] =>
  video.script.scenes.map((scene) => ({ id: scene.id, narration: scene.narration, title: scene.title, bullets: scene.bullets.join("\n"), visual: scene.visual, assetId: scene.assetId ?? null, graphic: scene.graphic ?? "" }));

const toEdit = (title: string, drafts: Draft[]): ScriptEdit => ({
  title,
  scenes: drafts.map((draft) => ({ id: draft.id, narration: draft.narration, title: draft.title, bullets: draft.bullets.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 5), visual: draft.visual, assetId: draft.visual === "image" ? draft.assetId : null, graphic: draft.graphic.trim() || null })),
});

// A diagram draws its own boxes and an Image scene shows its Assets picture, so neither gets a graphic
const showsGraphic = (draft: Draft) => draft.visual !== "diagram" && !(draft.visual === "image" && draft.assetId);

// SCRIPT: each scene's narration, on-screen text and visual, editable and in order. Nothing costs
// money until Make video; the cost estimate stays beside it.
export function ScriptEditor({ video, rates, assets }: { video: VideoRow; rates: CostRates; assets: AssetChoice[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(video.title);
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(video));
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const save = useServerAction(saveScript, { progress: false, refreshTables: [] });
  const make = useServerAction(makeVideo, { progress: false, refreshTables: [] });
  const rewrite = useServerAction(rewriteScript, { progress: { title: "Rewriting the script…" }, refreshTables: [] });
  const busy = save.isPending || make.isPending || rewrite.isPending;

  const saved = useMemo(() => JSON.stringify(toEdit(video.title, toDrafts(video))), [video]);
  const dirty = JSON.stringify(toEdit(title, drafts)) !== saved;
  const cost = useMemo(() => {
    const before = new Map(video.script.scenes.map((scene) => [scene.id, scene]));
    const scenes = drafts.map((draft) => {
      const scene = before.get(draft.id)!;
      return scene.narration === draft.narration ? scene : { ...scene, narration: draft.narration, audioPath: null, durationMs: null };
    });
    return estimateCost({ scenes }, video.length, rates);
  }, [drafts, video, rates]);

  const update = (id: string, patch: Partial<Draft>) => setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  const move = (index: number, by: -1 | 1) => setDrafts((current) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    return next;
  });
  const remove = (id: string) => setDrafts((current) => current.filter((draft) => draft.id !== id));

  const persist = async () => {
    const result = await save.run(video.id, toEdit(title, drafts));
    if (result.ok) router.refresh();
    return result.ok;
  };
  const start = async () => {
    if (dirty && !(await persist())) return;
    const result = await make.run(video.id);
    if (result.ok) router.refresh();
  };
  const runRewrite = async () => {
    const result = await rewrite.run(video.id);
    if (!result.ok) return;
    setConfirmRewrite(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-panel text-muted-foreground">Check the script. Voice and rendering start when you continue.</p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Title
        <Input value={title} maxLength={200} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <ol className="flex flex-col gap-3">
        {drafts.map((draft, index) => (
          <li key={draft.id} className="flex flex-col gap-3 rounded-xl border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium">Scene {index + 1}</h2>
              <div className="flex gap-1">
                <IconButton label="Move up" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconButton>
                <IconButton label="Move down" disabled={busy || index === drafts.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconButton>
                <IconButton label="Remove scene" disabled={busy || drafts.length === 1} onClick={() => remove(draft.id)}><Trash2 /></IconButton>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Narration
              <Textarea value={draft.narration} rows={4} disabled={busy} onChange={(event) => update(draft.id, { narration: event.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                On-screen title
                <Input value={draft.title} disabled={busy} onChange={(event) => update(draft.id, { title: event.target.value })} />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Visual</span>
                <div className="flex gap-2">
                  <NativeSelect aria-label="Visual" className="w-full" value={draft.visual} disabled={busy} onChange={(event) => update(draft.id, { visual: event.target.value as SceneVisual })}>
                    {SCENE_VISUALS.map((visual) => <NativeSelectOption key={visual} value={visual}>{SCENE_VISUAL_LABELS[visual]}</NativeSelectOption>)}
                  </NativeSelect>
                  {draft.visual === "image" ? (
                    <NativeSelect aria-label="Image" className="w-full" value={draft.assetId ?? ""} disabled={busy} onChange={(event) => update(draft.id, { assetId: event.target.value || null })}>
                      <NativeSelectOption value="">{assets.length ? "Choose image…" : "No images yet."}</NativeSelectOption>
                      {assets.map((asset) => <NativeSelectOption key={asset.id} value={asset.id}>{asset.label}</NativeSelectOption>)}
                    </NativeSelect>
                  ) : null}
                </div>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span className="flex items-center gap-1.5">On-screen points <InfoHint>One per line, up to five.</InfoHint></span>
              <Textarea value={draft.bullets} rows={3} disabled={busy} onChange={(event) => update(draft.id, { bullets: event.target.value })} />
            </label>
            {showsGraphic(draft) ? (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="flex items-center gap-1.5">Graphic <InfoHint>What this scene&apos;s illustration shows. It is drawn at Make video; leave it empty to draw from the title.</InfoHint></span>
                <Input value={draft.graphic} maxLength={240} disabled={busy} onChange={(event) => update(draft.id, { graphic: event.target.value })} />
              </label>
            ) : null}
            {draft.narration !== video.script.scenes.find((scene) => scene.id === draft.id)?.narration && video.script.scenes.find((scene) => scene.id === draft.id)?.audioPath ? (
              <p className="text-panel text-muted-foreground">This scene is voiced again.</p>
            ) : null}
          </li>
        ))}
      </ol>
      <ErrorNote error={save.error ?? make.error ?? rewrite.error} />
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-3">
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => void persist()}>{save.isPending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { rewrite.reset(); setConfirmRewrite(true); }}>Rewrite script</Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-panel text-muted-foreground tabular-nums">
            {formatUsd(cost.totalUsd)}
            <InfoHint>{`Estimate: voice ${formatUsd(cost.voiceUsd).replace("About ", "")} and render ${formatUsd(cost.renderUsd).replace("About ", "")}, about ${Math.max(1, Math.round(cost.videoMinutes))} min of video.`}</InfoHint>
          </span>
          <Button type="button" disabled={busy || !title.trim()} onClick={() => void start()}>{make.isPending ? "Starting…" : "Make video"}</Button>
        </div>
      </div>
      <Dialog open={confirmRewrite} onOpenChange={(open) => { if (!open && !rewrite.isPending) setConfirmRewrite(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rewrite the script?</DialogTitle>
            <DialogDescription>The Narrator writes new scenes from the same source. Your edits to the scenes are replaced.</DialogDescription>
          </DialogHeader>
          <ErrorNote error={rewrite.error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={rewrite.isPending} onClick={() => setConfirmRewrite(false)}>Cancel</Button>
            <Button type="button" disabled={rewrite.isPending} onClick={() => void runRewrite()}>{rewrite.isPending ? "Rewriting…" : "Rewrite script"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
    </Tooltip>
  );
}
