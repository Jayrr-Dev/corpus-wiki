"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/standard/info-popover";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/actions/useServerAction";
import { publishSpaceWiki, previewWikiPublication, getWikiMetrics } from "@/lib/server-actions/publishing";
import { WikiArticle } from "@/components/publishing/WikiArticle";
import type { PublicationEditor, Visibility, WikiBody, WikiMetrics } from "@/lib/publishing/types";

const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const emptyOrigin = () => "";
const inputClass = "w-full rounded-lg border bg-transparent px-2.5 py-2 text-panel outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function PublishingPanel({ editor, initialMetrics }: { editor: PublicationEditor; initialMetrics: WikiMetrics }) {
  const pub = editor.publication;
  const [visibility, setVisibility] = useState<Visibility>(pub?.visibility ?? "private");
  const [title, setTitle] = useState(pub?.title ?? editor.spaceName);
  const [description, setDescription] = useState(pub?.description ?? "");
  const [publisher, setPublisher] = useState(pub?.publisher ?? "");
  const [embedEnabled, setEmbedEnabled] = useState(pub?.embedEnabled ?? false);
  const [selected, setSelected] = useState(() => new Set(editor.pages.filter(p => p.selected).map(p => p.id)));
  const [fingerprints, setFingerprints] = useState(() => Object.fromEntries(editor.pages.map(p => [p.id, p.fingerprint])));
  const [preview, setPreview] = useState<WikiBody | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const [embedPage, setEmbedPage] = useState("");
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, emptyOrigin);
  const router = useRouter();
  const save = useServerAction(publishSpaceWiki, { progress: { title: "Publishing wiki", detail: "Saving the reviewed edition…" } });
  const previewAction = useServerAction(previewWikiPublication, { progress: false });
  const live = pub && pub.visibility !== "private";
  const readyPageCount = editor.pages.filter(page => page.hasText).length;
  const publicUrl = pub ? `${origin}/s/${pub.slug}` : "";
  const embedUrl = pub ? `${origin}/embed/${pub.slug}${embedPage ? `/wiki/${encodeURIComponent(embedPage)}` : ""}` : "";
  const code = `<iframe src="${embedUrl}" title="Published wiki" width="100%" height="700" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" style="border:0"></iframe>`;

  async function publish(makePrivate = false) {
    setMessage("");
    const result = await save.run({ visibility: makePrivate ? "private" : visibility, title: makePrivate ? editor.spaceName : title, description, publisher, embedEnabled,
      pages: makePrivate ? [] : [...selected].map(id => ({ id, fingerprint: fingerprints[id]! })),
    });
    if (result.ok) {
      setMessage(makePrivate || visibility === "private" ? "Space is private." : "Published.");
      router.refresh();
    }
  }
  async function showPreview(id: string) {
    const result = await previewAction.run(id);
    if (result.ok) { setPreview(result.body); setFingerprints(f => ({ ...f, [id]: result.fingerprint })); setReviewed(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage("Copied to clipboard."); }
    catch { setMessage("Select and copy the text below."); }
  }
  function choose(id: string) {
    setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setReviewed(false);
  }

  return <div className="space-y-6 text-panel">
    <section aria-labelledby="visibility-heading" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h2 id="visibility-heading" className="font-medium">Visibility</h2>
        <InfoPopover label="About visibility">
          <p>Private: only you. Unlisted: anyone with the link. Public: also listed in Explore.</p>
          <p className="mt-2">Only published pages are shared. Later edits stay private until republished. Unlisted links can be forwarded.</p>
        </InfoPopover>
      </div>
      <RadioGroup.Root aria-labelledby="visibility-heading" orientation="horizontal" value={visibility} disabled={save.isPending}
        onValueChange={value => { setVisibility(value as Visibility); setReviewed(false); }}
        className="inline-flex rounded-lg border bg-sidebar p-0.5">
        {(["private", "unlisted", "public"] as const).map(value => <RadioGroup.Item key={value} value={value}
          className="rounded-md px-3 py-1.5 text-panel text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-background data-[state=checked]:text-foreground disabled:opacity-50">
          {value[0]!.toUpperCase() + value.slice(1)}
        </RadioGroup.Item>)}
      </RadioGroup.Root>
    </section>
    {visibility === "private" && <section aria-labelledby="private-space-heading" className="space-y-5 border-t pt-5">
      <div>
        <h2 id="private-space-heading" className="font-medium">{editor.spaceName}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{live ? "Sharing stays active until you apply Private." : "Only you can access this space. Public links and embeds are off."}</p>
      </div>
      <dl className="grid grid-cols-3 gap-4">
        <div><dt className="text-xs text-muted-foreground">Pages</dt><dd className="mt-1 font-medium tabular-nums">{editor.pages.length}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Ready to publish</dt><dd className="mt-1 font-medium tabular-nums">{readyPageCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Public access</dt><dd className="mt-1 font-medium">{live ? "Still active" : "Off"}</dd></div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline"><Link href="/">{editor.pages.length ? "View pages" : "Create a page"}</Link></Button>
        {readyPageCount > 0 && <Button variant="ghost" disabled={save.isPending} onClick={() => { setVisibility("unlisted"); setReviewed(false); }}>Prepare sharing</Button>}
      </div>
    </section>}
    {visibility !== "private" && <>
      <p className="text-xs text-muted-foreground">{visibility === "unlisted" ? "Anyone with the link can read." : "Listed in Explore. Anyone can read."}</p>
      <section aria-label="Public details" className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <label className="space-y-2">Wiki name<Input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} disabled={save.isPending} /></label>
        <label className="space-y-2">Publisher<Input value={publisher} placeholder="Optional" maxLength={80} onChange={e => setPublisher(e.target.value)} disabled={save.isPending} /></label>
        <label className="space-y-2 sm:col-span-2">Description<textarea className={inputClass} rows={2} value={description} maxLength={500} onChange={e => setDescription(e.target.value)} disabled={save.isPending} /></label>
      </section>
      <section aria-labelledby="pages-heading" className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><h2 id="pages-heading" className="font-medium">Pages</h2><span className="text-xs text-muted-foreground">{selected.size}/100</span>
            <InfoPopover label="What gets published"><p>Selected article text, lists, tables, and charts. Media, source files, citations, and history stay private.</p><p className="mt-2">Preview the text and check for sensitive information before publishing.</p></InfoPopover>
          </div>
          <Tooltip content="Refresh drafts"><Button aria-label="Refresh drafts" variant="ghost" size="icon-sm" disabled={save.isPending} onClick={() => router.refresh()}><RefreshCw size={14} aria-hidden="true" /></Button></Tooltip>
        </div>
        {editor.pages.length > 6 && <Input aria-label="Filter pages" type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a page…" />}
        {editor.pages.length ? <ul className="max-h-72 divide-y overflow-auto">
          {editor.pages.filter(p => p.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(page => <li key={page.id} className="flex items-center justify-between gap-3 py-2">
            <label className="flex min-w-0 flex-1 items-center gap-3"><input type="checkbox" checked={selected.has(page.id)} disabled={save.isPending || (!page.hasText && !selected.has(page.id)) || (!selected.has(page.id) && selected.size >= 100)} onChange={() => choose(page.id)} className="size-3.5 shrink-0 accent-foreground" /><span className="break-words">{page.title}{!page.hasText && <span className="ml-2 text-xs text-muted-foreground">Empty</span>}</span></label>
            <Button variant="ghost" size="sm" disabled={previewAction.isPending || save.isPending} onClick={() => showPreview(page.id)}>Preview</Button>
          </li>)}
          {!editor.pages.some(p => p.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) && <li className="py-3 text-muted-foreground">No matching pages.</li>}
        </ul> : <p className="py-2 text-muted-foreground"><Link href="/" className="text-link hover:underline">Create a page</Link> to start publishing.</p>}
        {previewAction.error && <p role="alert" className="text-failed">{previewAction.error}</p>}
        {preview && <div className="border-y py-4"><div className="mb-5 flex items-center justify-between"><h3 className="text-xs font-medium text-muted-foreground">Visitor preview</h3><Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Close</Button></div>{preview.sections.length ? <WikiArticle body={preview} /> : <p className="text-muted-foreground">No article text yet.</p>}</div>}
      </section>
      <div className="flex items-center justify-between gap-3 border-t pt-5">
        <label className="flex items-center gap-3"><input type="checkbox" checked={embedEnabled} disabled={save.isPending} onChange={e => setEmbedEnabled(e.target.checked)} className="size-3.5 accent-foreground" />Allow embeds</label>
        <InfoPopover label="About embeds">Any website can embed the published wiki. Private workspace content stays hidden.</InfoPopover>
      </div>
      <label className="flex items-start gap-3"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={save.isPending} className="mt-0.5 size-3.5 shrink-0 accent-foreground" /><span>I’ve reviewed these pages and can publish them.</span></label>
    </>}
    {(visibility !== "private" || live) && <div className="flex flex-wrap items-center gap-2">
      <Button disabled={save.isPending || (visibility !== "private" && (!selected.size || !reviewed || !title.trim()))} onClick={() => publish(visibility === "private")}>{save.isPending ? "Saving…" : visibility === "private" ? "Make private" : live ? "Publish changes" : "Publish"}</Button>
      {live && visibility !== "private" && <Button disabled={save.isPending} variant="ghost" onClick={() => publish(true)}>Unpublish</Button>}
      {live && <InfoPopover label="About unpublishing">Unpublishing disables public links, embeds, and the Explore listing. Existing copies cannot be recalled.</InfoPopover>}
    </div>}
    {save.error && <p role="alert" className="text-failed">{save.error}</p>}
    {message && <p role="status">{message}</p>}
    {live && <section aria-labelledby="share-heading" className="space-y-4 border-t pt-5">
      <h2 id="share-heading" className="font-medium">Share</h2>
      <div className="flex items-center gap-2"><Input aria-label="Public wiki link" readOnly value={publicUrl} onFocus={e => e.target.select()} /><Button variant="outline" onClick={() => copy(publicUrl)}>Copy</Button><Button asChild variant="ghost"><a href={publicUrl} target="_blank" rel="noopener noreferrer">Open</a></Button></div>
      {pub.embedEnabled && <details className="text-panel"><summary className="cursor-pointer py-1 text-muted-foreground hover:text-foreground">Embed code</summary><div className="mt-3 space-y-3">
        <NativeSelect aria-label="Embed starting page" value={embedPage} onChange={e => setEmbedPage(e.target.value)}><option value="">Whole wiki</option>{editor.publishedPages.map(p => <option key={p.slug} value={p.slug}>{p.title}</option>)}</NativeSelect>
        <textarea aria-label="Iframe embed code" readOnly rows={3} value={code} onFocus={e => e.target.select()} className={`${inputClass} font-mono text-xs`} />
        <div className="flex gap-2"><Button variant="outline" onClick={() => copy(code)}>Copy code</Button><Button asChild variant="ghost"><a href={embedUrl} target="_blank" rel="noopener noreferrer">Preview</a></Button></div>
      </div></details>}
    </section>}
    {(live || initialMetrics.views > 0) && <OwnerMetrics initial={initialMetrics} />}
  </div>;
}

function OwnerMetrics({ initial }: { initial: WikiMetrics }) {
  const [metrics, setMetrics] = useState(initial);
  const [days, setDays] = useState(initial.days);
  const requestId = useRef(0);
  const action = useServerAction(getWikiMetrics, { progress: false });
  async function refresh(value: number) {
    setDays(value);
    const id = ++requestId.current;
    const result = await action.run(value);
    if (id === requestId.current && result.ok) setMetrics(result.metrics);
  }
  return <section aria-labelledby="metrics-heading" className="space-y-5 border-t pt-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><h2 id="metrics-heading" className="font-medium">Readers</h2>
        <InfoPopover label="How reader metrics work"><p>Only you can see these metrics. Views are deduplicated per article, tab, and 30 minutes. Sessions count browser tabs per UTC day, not unique people. Engaged reads need 30 visible seconds.</p><p className="mt-2">Known bots and your signed-in visits are excluded. Privacy preferences or blocked storage can reduce counts. Reports cover up to 90 days.</p></InfoPopover>
      </div>
      <div className="flex items-center gap-1"><NativeSelect aria-label="Metrics period" size="sm" value={days} onChange={e => refresh(Number(e.target.value))} disabled={action.isPending}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></NativeSelect>
        <Tooltip content="Refresh metrics"><Button aria-label="Refresh metrics" variant="ghost" size="icon-sm" disabled={action.isPending} onClick={() => refresh(days)}><RefreshCw size={14} aria-hidden="true" /></Button></Tooltip>
      </div>
    </header>
    {action.error && <p role="alert" className="text-failed">{action.error}</p>}
    <dl className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-5">{[
      ["Views", metrics.views], ["Daily sessions", metrics.sessions], ["Engaged", metrics.engagedReads], ["Embeds", metrics.embedViews], ["Explore", metrics.exploreViews],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-medium tabular-nums">{Number(value).toLocaleString()}</dd></div>)}</dl>
    {metrics.views ? <div className="space-y-5">
      <table className="w-full text-left"><caption className="mb-2 text-left text-xs text-muted-foreground">Most-read pages</caption><thead className="sr-only"><tr><th scope="col">Page</th><th scope="col">Views</th></tr></thead><tbody>{metrics.topPages.map(p => <tr key={p.slug} className="border-b last:border-0"><td className="py-2 pr-3">{p.title}</td><td className="py-2 text-right tabular-nums">{p.views}</td></tr>)}</tbody></table>
      <details><summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Daily activity</summary><table className="mt-3 w-full text-left"><thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="pb-2 font-normal">Date (UTC)</th><th scope="col" className="pb-2 text-right font-normal">Views</th><th scope="col" className="pb-2 text-right font-normal">Embeds</th></tr></thead><tbody>{metrics.daily.slice(-10).reverse().map(d => <tr key={d.date} className="border-b last:border-0"><td className="py-2">{d.date}</td><td className="py-2 text-right tabular-nums">{d.views}</td><td className="py-2 text-right tabular-nums">{d.embeds}</td></tr>)}</tbody></table></details>
    </div> : <p className="text-xs text-muted-foreground">No reader activity yet.</p>}
  </section>;
}
