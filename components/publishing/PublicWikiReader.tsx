import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark, BrandName } from "@/components/brand/BrandMark";
import { readPublicWiki } from "@/lib/publishing/server";
import { makeMetricTicket } from "@/lib/publishing/metricTicket";
import { WikiArticle } from "./WikiArticle";
import { ReadMetrics } from "./ReadMetrics";

export async function PublicWikiReader({ slug, pageSlug, embed = false, query = "", fromExplore = false }: {
  slug: string; pageSlug?: string; embed?: boolean; query?: string; fromExplore?: boolean;
}) {
  let wiki = await readPublicWiki(slug, pageSlug ?? null, embed);
  if (!wiki || (pageSlug && !wiki.page)) notFound();
  const candidates = wiki.pages.filter(p => p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (!pageSlug && candidates[0]) {
    const selected = await readPublicWiki(slug, candidates[0].slug, embed);
    // Check the edition again if it changed between these two reads.
    if (!selected?.page) notFound();
    wiki = selected;
  }
  const pages = wiki.pages.filter(p => p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const base = `${embed ? "/embed" : "/s"}/${slug}`;
  const ticket = wiki.page ? makeMetricTicket({ slug, page: wiki.page.slug, edition: wiki.edition, surface: embed ? "embed" : "site", channel: embed ? "embed" : fromExplore ? "explore" : "direct" }) : null;
  return <div className={embed ? "min-h-svh px-4 py-5 sm:px-6" : "mx-auto min-h-svh max-w-7xl px-5 py-6 sm:px-9"}>
    {!embed && <nav aria-label="Public navigation" className="mb-10 flex items-center justify-between text-sm"><Link prefetch={false} href="/explore" className="flex items-center gap-2 font-medium hover:underline"><BrandMark /><BrandName className="text-body font-normal" /> / Public</Link><Link href="/pages" className="text-muted-foreground hover:underline">My workspace</Link></nav>}
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div className="max-w-2xl"><Link prefetch={false} href={base} className="text-xl font-semibold hover:underline">{wiki.title}</Link>
        {wiki.description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{wiki.description}</p>}
        <p className="mt-3 text-xs text-muted-foreground">{wiki.publisher && <>Published by {wiki.publisher}. </>}Updated {new Date(wiki.publishedAt).toISOString().slice(0, 10)} · Read only{wiki.visibility === "unlisted" ? " · Unlisted" : ""}</p>
      </div>
      {embed && <a href={`/s/${slug}${wiki.page ? `/wiki/${encodeURIComponent(wiki.page.slug)}` : ""}`} target="_blank" rel="noopener noreferrer" className="text-sm text-link hover:underline">Open full wiki</a>}
    </header>
    <div className="grid items-start gap-8 md:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
      <aside className="min-w-0 md:sticky md:top-6">
        <form action={base} role="search"><label htmlFor="wiki-search" className="mb-2 block text-xs font-medium">Find a page</label><div className="flex gap-2"><input id="wiki-search" name="q" defaultValue={query} maxLength={120} placeholder="Page title…" className="min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm" /><button type="submit" className="rounded-md border px-2 text-sm hover:bg-hover">Find</button></div></form>
        <nav aria-label="Wiki pages" className="mt-5 max-h-72 overflow-auto md:max-h-[65svh]"><ul className="space-y-1">{pages.map(p => <li key={p.slug}><Link prefetch={false} href={`${base}/wiki/${encodeURIComponent(p.slug)}`} aria-current={wiki.page?.slug === p.slug ? "page" : undefined} className={`block rounded-md px-3 py-2 text-sm ${wiki.page?.slug === p.slug ? "bg-hover font-medium" : "text-muted-foreground hover:bg-hover hover:text-foreground"}`}>{p.title}</Link></li>)}</ul>
          {!pages.length && <p className="text-sm text-muted-foreground">No page titles match. <Link prefetch={false} href={base} className="text-link hover:underline">Show all pages</Link></p>}
        </nav>
      </aside>
      <main id="wiki-content" className="min-w-0 max-w-3xl pb-10">
        {wiki.page ? <WikiArticle body={wiki.page} /> : <p className="py-8 text-muted-foreground">No page found. Try another search.</p>}
        <footer className="mt-12 border-t pt-4 text-xs leading-5 text-muted-foreground">This is a published edition. Source files{wiki.page?.sources?.length ? "" : ", private citations"} and workspace controls are not included. Anonymous reading counts are collected without tracking cookies; browser privacy preferences are honored.</footer>
        {ticket && <ReadMetrics key={ticket} ticket={ticket} />}
      </main>
    </div>
  </div>;
}
