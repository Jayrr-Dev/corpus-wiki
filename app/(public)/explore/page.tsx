import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Search } from "lucide-react";
import { explorePublicWikis } from "@/lib/publishing/server";
import { exploreOffset } from "@/lib/publishing/validation";

export const metadata: Metadata = { title: "Explore public knowledge | Second Brain" };
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; offset?: string }> }) {
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q.slice(0, 120).trim() : "";
  const offset = exploreOffset(typeof search.offset === "string" ? search.offset : undefined);
  const result = await explorePublicWikis(query, offset);
  const pagination = (start: number) => `/explore?${new URLSearchParams({ q: query, offset: String(start) })}`;
  return <div className="mx-auto max-w-6xl px-5 py-7 sm:px-10">
    <nav aria-label="Public navigation" className="flex items-center justify-between text-sm"><Link href="/explore" className="font-semibold">Second Brain</Link><Link href="/publishing" className="text-muted-foreground hover:underline">Publish your wiki</Link></nav>
    <header className="max-w-2xl pb-10 pt-14 sm:pt-20"><h1 className="font-serif text-4xl leading-tight sm:text-5xl">Knowledge worth sharing.</h1><p className="mt-4 text-base leading-7 text-muted-foreground">Explore wikis published by their owners. Find a space to read, or search the articles inside it.</p></header>
    <form action="/explore" role="search" className="mb-10 flex max-w-2xl gap-3"><label htmlFor="explore-search" className="sr-only">Search public spaces and articles</label><div className="flex flex-1 items-center gap-3 rounded-lg border px-4"><Search size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" /><input id="explore-search" type="search" name="q" defaultValue={query} maxLength={120} placeholder="Search spaces, topics, and article text…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /></div><button type="submit" className="rounded-lg bg-foreground px-5 text-sm font-medium text-background hover:opacity-85">Search</button></form>
    <main id="wiki-content"><div className="mb-4 flex items-center justify-between border-b pb-3"><h2 className="text-sm font-medium">{query ? `Results for “${query}”` : "Recently published"}</h2><p className="text-xs text-muted-foreground">{result.total} {result.total === 1 ? "space" : "spaces"}</p></div>
      {result.spaces.length ? <div className="grid gap-x-10 md:grid-cols-2">{result.spaces.map(space => <article key={space.slug} className="border-b py-7">
        <div className="flex items-start gap-3"><BookOpen size={20} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground" /><div className="min-w-0"><h3 className="text-xl font-semibold"><Link prefetch={false} href={`/s/${space.slug}?from=explore`} className="hover:text-link hover:underline">{space.title}</Link></h3>{space.description && <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{space.description}</p>}
          <p className="mt-4 text-xs text-muted-foreground">{space.publisher && <>{space.publisher} · </>}{space.page_count} {space.page_count === 1 ? "article" : "articles"} · Updated {new Date(space.published_at).toISOString().slice(0, 10)}</p>
          {space.matching_pages.length > 0 && <ul className="mt-4 space-y-2 border-l pl-3">{space.matching_pages.map(page => <li key={page.slug}><Link prefetch={false} className="text-sm text-link hover:underline" href={`/s/${space.slug}/wiki/${encodeURIComponent(page.slug)}?from=explore`}>{page.title}</Link></li>)}</ul>}
        </div></div>
      </article>)}</div> : <div className="max-w-xl py-14"><h3 className="text-lg font-medium">{query ? "No public spaces match yet" : "The public library starts here"}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{query ? "Try a broader topic or a different word. Unlisted and private spaces never appear here." : "Publish selected pages from your space to make them available here. Private and unlisted spaces stay out of Explore."}</p><Link href={query ? "/explore" : "/publishing"} className="mt-4 inline-block text-sm text-link hover:underline">{query ? "Clear search" : "Choose pages to publish"}</Link></div>}
      <nav aria-label="Search results pages" className="mt-8 flex justify-between text-sm">{offset > 0 ? <Link prefetch={false} href={pagination(Math.max(0, offset - 20))} className="text-link hover:underline">Previous</Link> : <span />}{offset + 20 < result.total && offset < 10000 && <Link prefetch={false} href={pagination(offset + 20)} className="text-link hover:underline">Next</Link>}</nav>
    </main>
  </div>;
}
