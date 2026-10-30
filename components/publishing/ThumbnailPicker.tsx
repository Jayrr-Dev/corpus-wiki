"use client";

import { useEffect, useRef, useState } from "react";
import { AssetThumbnail, assetTitle, type Asset } from "@/app/(app)/assets/AssetMedia";
import { useServerAction } from "@/components/actions/useServerAction";
import { InfoHint } from "@/components/standard/info-hint";
import { Button } from "@/components/ui/button";
import { canBeThumbnail } from "@/lib/publishing/thumbnail";
import type { ThumbnailState } from "@/lib/publishing/types";
import { useAssets } from "@/lib/queries";
import { autoPickSpaceThumbnail, chooseSpaceThumbnail, removeSpaceThumbnail, uploadSpaceThumbnail } from "@/lib/server-actions/publishing";
import { SpaceCover } from "./SpaceCover";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// THUMBNAIL: the picture on this Space's public card. Upload one, take one from the
// Space's assets, or let the app pick. The original file always stays private.
export function ThumbnailPicker({ thumbnail, title, onChange }: { thumbnail: ThumbnailState; title: string; onChange: () => void }) {
  const [browsing, setBrowsing] = useState(false);
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const upload = useServerAction(uploadSpaceThumbnail, { progress: { title: "Saving thumbnail" } });
  const choose = useServerAction(chooseSpaceThumbnail, { progress: { title: "Saving thumbnail" } });
  const pick = useServerAction(autoPickSpaceThumbnail, { progress: { title: "Picking a thumbnail" } });
  const remove = useServerAction(removeSpaceThumbnail, { progress: false });
  const busy = upload.isPending || choose.isPending || pick.isPending || remove.isPending;
  const error = problem || upload.error || choose.error || pick.error || remove.error;

  function changed(note = "") {
    setBrowsing(false);
    setProblem("");
    setMessage(note);
    onChange();
  }
  async function sendFile(file: File | undefined) {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { setProblem("That image is too large. Use one under 5 MB."); return; }
    const form = new FormData();
    form.set("file", file);
    if ((await upload.run(form)).ok) changed();
  }
  async function autoPick() {
    const result = await pick.run();
    if (result.ok) changed(result.picked ? "" : "No suitable picture found. Keeping the drawn cover.");
  }

  return <section aria-labelledby="thumbnail-heading" className="space-y-3 border-t pt-5">
    <div className="flex items-center gap-2"><h2 id="thumbnail-heading" className="font-medium">Thumbnail</h2>
      <InfoHint>Shown on your Public page card. A resized copy becomes public; the original stays private.</InfoHint>
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <SpaceCover slug={thumbnail.slug} title={title} version={thumbnail.version} className="w-40 shrink-0 rounded-lg border" />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Thumbnail image" className="sr-only" tabIndex={-1} onChange={e => sendFile(e.target.files?.[0])} />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>Upload</Button>
        <Button variant="outline" size="sm" disabled={busy} aria-expanded={browsing} onClick={() => setBrowsing(open => !open)}>Assets</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={autoPick}>Pick for me</Button>
        {thumbnail.version && <Button variant="ghost" size="sm" disabled={busy} onClick={async () => { if ((await remove.run()).ok) changed(); }}>Remove</Button>}
      </div>
    </div>
    {browsing && <AssetChoices busy={busy} onChoose={async asset => { if ((await choose.run(asset.id)).ok) changed(); }} onCancel={() => setBrowsing(false)} />}
    {error && <p role="alert" className="text-failed">{error}</p>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
  </section>;
}

export type ThumbnailDraft = { file: File; url: string } | { asset: Asset };

// Before a first publish there is nothing to save a picture to yet, so the choice waits
// here and the panel saves it the moment the publish succeeds. No choice means auto-pick.
export function ThumbnailDraftPicker({ draft, title, disabled, onChange }: { draft: ThumbnailDraft | null; title: string; disabled: boolean; onChange: (draft: ThumbnailDraft | null) => void }) {
  const [browsing, setBrowsing] = useState(false);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const fileUrl = draft && "file" in draft ? draft.url : null;
  useEffect(() => { if (fileUrl) return () => URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  function chooseFile(next: File | undefined) {
    if (input.current) input.current.value = "";
    if (!next) return;
    if (next.size > MAX_UPLOAD_BYTES) { setProblem("That image is too large. Use one under 5 MB."); return; }
    setProblem("");
    onChange({ file: next, url: URL.createObjectURL(next) });
  }

  return <section aria-labelledby="thumbnail-heading" className="space-y-3 border-t pt-5">
    <div className="flex items-center gap-2"><h2 id="thumbnail-heading" className="font-medium">Thumbnail</h2>
      <InfoHint>Shown on your Public page card. A resized copy becomes public; the original stays private.</InfoHint>
    </div>
    <div className="flex flex-wrap items-center gap-4">
      {draft && "asset" in draft ? <AssetThumbnail asset={draft.asset} alt="Chosen thumbnail" className="aspect-[8/5] w-40 shrink-0 rounded-lg border" />
        : fileUrl ? <div role="img" aria-label="Chosen thumbnail" className="aspect-[8/5] w-40 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: `url(${fileUrl})` }} />
          : <SpaceCover slug={"0".repeat(32)} title={title} version={null} className="w-40 shrink-0 rounded-lg border" />}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Thumbnail image" className="sr-only" tabIndex={-1} onChange={e => chooseFile(e.target.files?.[0])} />
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>Upload</Button>
          <Button variant="outline" size="sm" disabled={disabled} aria-expanded={browsing} onClick={() => setBrowsing(open => !open)}>Assets</Button>
          {draft && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>Remove</Button>}
        </div>
        {!draft && <p className="text-xs text-muted-foreground">We’ll pick one when you publish.</p>}
      </div>
    </div>
    {browsing && <AssetChoices busy={disabled} onChoose={asset => { onChange({ asset }); setBrowsing(false); }} onCancel={() => setBrowsing(false)} />}
    {problem && <p role="alert" className="text-failed">{problem}</p>}
  </section>;
}

function AssetChoices({ busy, onChoose, onCancel }: { busy: boolean; onChoose: (asset: Asset) => void; onCancel: () => void }) {
  const assets = useAssets({ filters: { kind: "image", deleted_at: null } });
  const choices = (assets.data ?? []).filter(canBeThumbnail);
  return <div className="space-y-2">
    {assets.isLoading ? <p className="text-muted-foreground">Loading assets…</p> : choices.length ? (
      <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-auto sm:grid-cols-4">
        {choices.map(asset => {
          const name = assetTitle(asset, undefined);
          return <li key={asset.id}>
            <button type="button" disabled={busy} aria-label={`Use ${name}`} onClick={() => onChoose(asset)} className="block w-full overflow-hidden rounded-md border outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              <AssetThumbnail asset={asset} alt="" />
            </button>
          </li>;
        })}
      </ul>
    ) : <p className="text-muted-foreground">No pictures in this space yet.</p>}
    <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
  </div>;
}
