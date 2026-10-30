"use client";
import { MediaImage } from "@/components/preview/MediaImage";


import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Clock3, ImageIcon, RefreshCw, Shuffle } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/standard/tooltip";
import { QueryState, TextLink } from "@/app/(app)/_components/bits";
import { DateTime, useTimeZone } from "@/app/(app)/_components/DateTime";
import { useFrontPage } from "@/lib/queries/frontPage";
import { useSectionLines } from "@/lib/queries";
import { useArticleEvidence } from "@/lib/queries/articleEvidence";
import { sourceFileSrc } from "@/lib/living-page/articleEvidence";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/queries/keys";
import { buildFrontArticles, dailyOrder, editionDay, excerptBlocks, frontSelections, plainExcerpt, type FrontArticle } from "@/lib/living-page/frontPage";
import { BlockPartView } from "@/components/living-page/LineBlock";
import { PagesTable } from "./PagesTable";
import { useActiveSpace } from "@/components/shell/SpaceProvider";
import { readSpaceWelcome, refreshSpaceWelcome } from "@/lib/server-actions/spaceWelcome";
import { describeCallError } from "@/lib/server-actions/result";

export function PagesHome() {
  const [view, setView] = useState<"front" | "browse">("front");
  return <div className="space-y-5">
    <nav aria-label="Wiki views" className="flex gap-1 border-b pb-3">
      <Button size="sm" variant={view === "front" ? "secondary" : "ghost"} aria-pressed={view === "front"} onClick={() => setView("front")}>Main page</Button>
      <Button size="sm" variant={view === "browse" ? "secondary" : "ghost"} aria-pressed={view === "browse"} onClick={() => setView("browse")}>Browse pages</Button>
    </nav>
    {view === "front" ? <FrontPage browse={() => setView("browse")} /> : <PagesTable />}
  </div>;
}

function FrontPage({ browse }: { browse: () => void }) {
  const space = useActiveSpace();
  const saved = space.subtitle_for_name === space.name && space.subtitle?.trim() ? space.subtitle : null;
  // Only an unsaved subtitle needs the action (it calls the AI, a few seconds).
  // A failure resolves to null so it is cached, not retried on every visit.
  const welcome = useQuery({
    queryKey: ["space-welcome", space.id, space.name],
    enabled: !saved,
    queryFn: async () => {
      const result = await readSpaceWelcome();
      if (!result.ok || result.spaceId !== space.id || result.title !== space.name) return null;
      return result.subtitle;
    },
    staleTime: Infinity,
    retry: false,
  });
  const router = useRouter();
  // The refresh shows at once; router.refresh brings the saved copy into the layout's space.
  const refresh = useMutation({
    mutationFn: async () => {
      const result = await refreshSpaceWelcome();
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSuccess: () => router.refresh(),
    onError: (error) => toast.error(describeCallError(error)),
  });
  const refreshed = refresh.data?.spaceId === space.id && refresh.data.title === space.name ? refresh.data.subtitle : null;
  const subtitle = refreshed ?? saved ?? welcome.data;
  const data = useFrontPage();
  const zone = useTimeZone();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const articles = buildFrontArticles(data.pages.data?.rows ?? [], data.sections.data ?? [], data.changes.data ?? []);
  const day = now ? editionDay(now, zone) : "";
  const { featured, recent, discover, rediscover } = frontSelections(articles, day);
  const parents = articles.filter((a) => articles.some((child) => child.parent_page_id === a.id));
  const topics = parents.length ? parents : articles.filter((a) => !a.parent_page_id);
  const query = { isPending: !now || data.pages.isPending || data.sections.isPending, error: data.pages.error ?? data.sections.error };
  return <QueryState query={query}>
    <div className="space-y-4">
      <section className="rounded-md border bg-sidebar/40 px-5 py-7 text-center sm:px-8" aria-label="Welcome">
        <p className="mb-2 text-xs text-muted-foreground">{now?.toLocaleDateString("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        <h2 className="break-words text-2xl font-medium tracking-tight">{space.name}</h2>
        <p className="group/subtitle mt-2 text-muted-foreground">
          {subtitle || "A place to collect ideas, make connections, and keep exploring."}
          {/* The negative margin keeps the line centred on the words, not words plus icon. */}
          <Tooltip content="Update from new knowledge"><button type="button" aria-label="Update tag line" disabled={refresh.isPending} onClick={() => refresh.mutate()} className={`-mr-7 ml-1 inline-flex size-6 items-center justify-center rounded-md align-middle outline-none transition-opacity hover:bg-hover hover:text-foreground group-hover/subtitle:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait [@media(hover:none)]:opacity-100 ${refresh.isPending ? "opacity-100" : "opacity-0"}`}><RefreshCw className={`size-3.5 ${refresh.isPending ? "animate-spin" : ""}`} aria-hidden="true" /></button></Tooltip>
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
          <button className="text-link hover:underline" onClick={browse}>{data.pages.data?.count.toLocaleString()} articles</button>
          <TextLink href="/sources">{data.sources.isSuccess ? `${data.sources.data.count.toLocaleString()} sources` : "Sources"}</TextLink>
          <TextLink href="/domains">Explore domains</TextLink>
        </div>
      </section>

      {!articles.length ? <section className="rounded-md border p-6 text-center">
        <BookOpen className="mx-auto mb-3 size-5 text-muted-foreground" />
        <h2 className="font-medium">Your front page starts here</h2>
        <p className="mt-2 text-muted-foreground">Upload a source or create a page to start.</p>
        <Button asChild variant="outline" size="sm" className="mt-4"><Link href="/upload">Upload documents</Link></Button>
      </section> : <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-applied" />Today’s selections · updated daily</span>
          <Button size="xs" variant="ghost" onClick={() => {
            const choices = articles.length > 1 ? articles.filter((a) => a.id !== featured?.id) : articles;
            const target = choices[(crypto.getRandomValues(new Uint32Array(1))[0]! % choices.length)];
            if (target) router.push(`/p/${target.slug}`);
          }}><Shuffle className="size-3" />Random article</Button>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {featured ? <Panel title="From today’s featured article" mark="text-applied"><FeaturedArticle key={featured.id} article={featured} /></Panel> : <Panel title="Your growing collection" mark="text-applied"><p className="text-muted-foreground">An article is featured here each day once pages have content.</p><button onClick={browse} className="mt-3 text-link hover:underline">Browse your pages →</button></Panel>}
            {!!discover.length && <Panel title="Discover something" mark="text-applied" shape="diamond"><ul className="space-y-4">{discover.map((a) => <li key={a.id}><TextLink href={`/p/${a.slug}`} className="font-medium">{a.title}</TextLink><p className="mt-1 leading-6 text-muted-foreground">{plainExcerpt(a.excerpt, 210)}</p></li>)}</ul></Panel>}
          </div>
          <div className="min-w-0 space-y-4">
            {!!recent.length && <Panel title="Recently updated" mark="text-link" shape="circle" action={<TextLink href="/changes" className="text-xs">All changes</TextLink>}>
              {data.changes.error && <p role="status" className="mb-3 text-xs text-muted-foreground">Live edit dates are unavailable; showing article build dates.</p>}
              <ul className="divide-y">{recent.map((a) => <li key={a.id} className="py-3 first:pt-0 last:pb-0"><TextLink href={`/p/${a.slug}`} className="font-medium">{a.title}</TextLink>{a.excerpt && <p className="mt-1 leading-5 text-muted-foreground">{plainExcerpt(a.excerpt, 150)}</p>}<p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3" /><DateTime iso={a.changedAt} /></p></li>)}</ul>
            </Panel>}
            {!!rediscover.length && <Panel title="Worth another look" mark="text-link" shape="triangle"><ul className="space-y-3">{rediscover.map((a) => <li key={a.id}><TextLink href={`/p/${a.slug}`}>{a.title}</TextLink><p className="mt-1 text-muted-foreground">{plainExcerpt(a.excerpt, 130)}</p></li>)}</ul></Panel>}
          </div>
        </div>
      </>}
      {data.sources.isSuccess && !!data.sources.data.media.length && <FeaturedMedia media={dailyOrder(data.sources.data.media, day)[0]!} />}
      {data.sources.error && <p role="status" className="text-xs text-muted-foreground">Media previews are temporarily unavailable. <TextLink href="/sources">Browse sources</TextLink></p>}
      {!!topics.length && <Panel title="Explore your collection" action={<button onClick={browse} className="text-xs text-link hover:underline">Browse all pages</button>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{topics.slice(0, 12).map((topic) => {
          const count = articles.filter((a) => a.parent_page_id === topic.id).length;
          return <Link key={topic.id} href={`/p/${topic.slug}`} className="group flex items-center justify-between gap-3 rounded-md border px-3 py-3 hover:bg-hover"><span className="min-w-0"><span className="text-link group-hover:underline">{topic.title}</span>{count > 0 && <span className="mt-1 block text-xs text-muted-foreground">{count} subpages</span>}</span><ArrowUpRight className="size-3.5 shrink-0 text-faint" /></Link>;
        })}</div>
      </Panel>}
      {(data.pages.data?.count ?? 0) > articles.length && <p className="text-xs text-muted-foreground">Selections drawn from the {articles.length} newest articles. <button onClick={browse} className="text-link hover:underline">Browse the full collection</button></p>}
    </div>
  </QueryState>;
}

function Panel({ title, mark, shape = "square", action, children }: { title: string; mark?: string; shape?: "square" | "circle" | "diamond" | "triangle"; action?: ReactNode; children: ReactNode }) {
  return <section className="overflow-hidden rounded-md border">
    <header className="flex items-center justify-between gap-3 border-b bg-sidebar/60 px-4 py-2.5"><h2 className="flex items-center gap-2.5 font-semibold">{mark && <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-3 shrink-0 ${mark}`} fill="currentColor">{shape === "circle" ? <circle cx="8" cy="8" r="5" /> : shape === "diamond" ? <path d="m8 1.5 6.5 6.5L8 14.5 1.5 8Z" /> : shape === "triangle" ? <path d="m8 2 6 11H2Z" /> : <rect x="3" y="3" width="10" height="10" rx="1" />}</svg>}{title}</h2>{action}</header>
    <div className="p-4">{children}</div>
  </section>;
}

function FeaturedArticle({ article }: { article: FrontArticle }) {
  const lines = useSectionLines(article.id);
  const evidence = useArticleEvidence(lines.data ?? []);
  const figure = [...evidence.figuresByLine.values()].flat().find((f) => f.kind === "image");
  return <article>
    <h3 className="mb-3 text-lg font-medium"><TextLink href={`/p/${article.slug}`}>{article.title}</TextLink></h3>
    <div className="flow-root text-body leading-7">
      {figure && <figure className="mb-3 sm:float-left sm:mr-4 sm:w-40"><MediaPreview sourceId={figure.sourceId} src={figure.src} kind="image" title={figure.title} caption={figure.caption} /><figcaption className="mt-1 text-xs leading-5 text-muted-foreground">{plainExcerpt(figure.caption, 150)}</figcaption></figure>}
      <div className="space-y-3">{excerptBlocks(article.body).map((part, index) => <BlockPartView key={index} part={part} />)}</div>
    </div>
    <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs"><span className="text-muted-foreground">{article.sectionCount} {article.sectionCount === 1 ? "section" : "sections"}</span><TextLink href={`/p/${article.slug}`}>Continue reading →</TextLink></footer>
  </article>;
}

type Media = { id: string; title: string; mime_type: string; url: string | null };
function FeaturedMedia({ media }: { media: Media }) {
  const caption = useQuery({
    queryKey: [...queryKeys.table("passages"), "front-page-caption", media.id],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().from("passages").select("text").eq("source_id", media.id).eq("position", 0).maybeSingle();
      if (error) throw error;
      return data?.text ?? "";
    },
  });
  return <Panel title="Today’s featured media" action={<TextLink href="/sources" className="text-xs">All sources</TextLink>}>
    <figure className="grid items-start gap-5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <MediaPreview key={media.id} sourceId={media.id} kind={media.mime_type.startsWith("video/") ? "video" : "image"} title={media.title} caption={caption.data || media.title} />
      <figcaption><TextLink href={`/sources/${media.id}`} className="text-lg font-medium">{media.title}</TextLink>{caption.data && <><p className="mt-3 leading-6 text-muted-foreground">{plainExcerpt(caption.data, 600)}</p><p className="mt-2 text-xs text-faint">AI description from your uploaded source</p></>}<p className="mt-4"><TextLink href={`/sources/${media.id}`}>View source and details →</TextLink></p></figcaption>
    </figure>
  </Panel>;
}

function MediaPreview({ sourceId, src = sourceFileSrc(sourceId), kind, title, caption }: { sourceId: string; src?: string; kind: "image" | "video"; title: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Link href={`/sources/${sourceId}`} className="flex aspect-video items-center justify-center gap-2 rounded-md border bg-sidebar text-muted-foreground"><ImageIcon className="size-4" />View source</Link>;
  if (kind === "video") return <video src={src} controls preload="none" aria-label={title} className="aspect-video w-full rounded-md border bg-sidebar object-contain" onError={() => setFailed(true)} />;
  return <a href={src} target="_blank" rel="noreferrer" aria-label={`Open image: ${title}`}>
    <MediaImage src={src} alt={plainExcerpt(caption, 240)} loading="lazy" className="aspect-video w-full rounded-md border bg-sidebar object-contain" onError={() => setFailed(true)} />
  </a>;
}
