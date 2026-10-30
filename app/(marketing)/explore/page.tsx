import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, BookOpen, MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { LandingFooter } from "@/components/landing/landing-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { SpaceCover } from "@/components/publishing/SpaceCover";
import { isFeatureEnabled } from "@/lib/flags/server";
import { contactEmail } from "@/lib/legal/contact";
import { splitFeatured } from "@/lib/publishing/explore";
import { explorePublicWikis } from "@/lib/publishing/server";
import type { ExploreResult } from "@/lib/publishing/types";
import { exploreOffset } from "@/lib/publishing/validation";
import { cn } from "@/lib/utils";

// =====================================================================
// PUBLIC (/explore): every Space its owner published as public. The hero
// and search paint first; the results stream in behind a skeleton. Search
// is a plain GET form, so it works and can be shared without JavaScript.
// =====================================================================

export const metadata: Metadata = {
  title: "Public Spaces | Corpus Wiki",
  description: "Read wikis their owners chose to share, and search the articles inside them.",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";
const BUTTON = `inline-flex items-center gap-2 rounded-xl border border-landing-ink/15 px-3 py-2 text-sm font-semibold transition duration-300 ease-landing hover:bg-landing-ink/[0.06] active:scale-[0.98] ${FOCUS}`;

type Space = ExploreResult["spaces"][number];

function exploreHref(query: string, offset = 0) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (offset) params.set("offset", String(offset));
  const search = params.toString();
  return search ? `/explore?${search}` : "/explore";
}

// lead: the large first card in Featured, whose cover fills the height the two beside it set
function SpaceCard({ space, lead = false }: { space: Space; lead?: boolean }) {
  const details = [
    space.publisher,
    `${space.page_count} ${space.page_count === 1 ? "article" : "articles"}`,
    new Date(space.published_at).toLocaleDateString(undefined, { dateStyle: "medium" }),
  ].filter(Boolean);
  return (
    <article className={cn("relative flex h-full flex-col overflow-hidden rounded-2xl border border-landing-ink/10 bg-landing-ink/[0.03] transition duration-300 ease-landing hover:-translate-y-1 hover:border-landing-ink/20 hover:bg-landing-ink/[0.05] motion-reduce:hover:translate-y-0", lead && "sm:col-span-2 lg:row-span-2")}>
      <SpaceCover slug={space.slug} title={space.title} version={space.thumbnail_version ?? null} className={cn(lead && "lg:aspect-auto lg:min-h-0 lg:flex-1")} />
      <div className={cn("flex flex-col p-6", !lead && "flex-1")}>
        <h3 className={cn("font-semibold text-balance", lead ? "text-2xl" : "text-lg")}>
          {/* The title's link stretches over the whole card; the article links sit above it */}
          <Link prefetch={false} href={`/s/${space.slug}?from=explore`} className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-landing-gold">
            {space.title}
          </Link>
        </h3>
        {space.description && <p className="mt-2 line-clamp-3 text-sm text-landing-ink/60 text-pretty">{space.description}</p>}
        {space.matching_pages.length > 0 && (
          <div className="relative z-10 mt-4">
            <p className="text-xs font-semibold text-landing-ink/50">Matching articles</p>
            <ul className="mt-1 flex flex-col gap-1">
              {space.matching_pages.map(page => (
                <li key={page.slug} className="truncate">
                  <Link prefetch={false} href={`/s/${space.slug}/wiki/${encodeURIComponent(page.slug)}?from=explore`} className={cn("rounded-sm text-sm text-landing-ink/80 underline decoration-landing-ink/25 underline-offset-4 transition-colors duration-300 hover:text-landing-ink", FOCUS)}>
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-auto pt-6 text-xs text-landing-ink/50">{details.join(" · ")}</p>
      </div>
    </article>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-landing-ink/10 bg-landing-ink/[0.03] px-6 py-16 text-center">
      <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-landing-green/25 text-landing-green-light"><BookOpen className="size-5" /></span>
      <h3 className="mt-4 text-lg font-semibold text-balance">{query ? `Nothing matches “${query}”` : "No public Spaces yet"}</h3>
      <p className="mt-2 max-w-md text-sm text-landing-ink/60 text-pretty">
        {query ? "Try a broader word or a different topic." : "Publish pages from your Space and they will show up here."}
      </p>
      <Link href={query ? "/explore" : "/pages"} className={cn(BUTTON, "mt-6")}>{query ? "Clear search" : "Publish a Space"}</Link>
    </div>
  );
}

async function Results({ query, offset }: { query: string; offset: number }) {
  const { total, spaces } = await explorePublicWikis(query, offset);
  const hasNext = offset + PAGE_SIZE < total && offset < 10000;
  // Featured only leads the first page of browsing; a search keeps its order
  const { featured, recent } = !query && offset === 0 ? splitFeatured(spaces) : { featured: [], recent: spaces };
  return (
    <>
      {featured.length > 0 && (
        <section aria-labelledby="featured-heading" className="mb-16">
          <h2 id="featured-heading" className="mb-6 text-2xl font-semibold tracking-tight">Featured Spaces</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((space, index) => <SpaceCard key={space.slug} space={space} lead={index === 0} />)}
          </div>
        </section>
      )}
      <section aria-labelledby="results-heading">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id="results-heading" className="text-2xl font-semibold tracking-tight">{query ? "Search results" : "New Spaces"}</h2>
          <p aria-live="polite" className="shrink-0 text-sm text-landing-ink/50">{total} {total === 1 ? "Space" : "Spaces"}</p>
        </div>
        {recent.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map(space => <SpaceCard key={space.slug} space={space} />)}
          </div>
        ) : <EmptyState query={query} />}
        {(offset > 0 || hasNext) && (
          <nav aria-label="Pages of results" className="mt-8 flex items-center justify-between gap-4">
            {offset > 0 ? <Link prefetch={false} href={exploreHref(query, Math.max(0, offset - PAGE_SIZE))} className={BUTTON}><ArrowLeft aria-hidden className="size-4" />Previous</Link> : <span />}
            {hasNext ? <Link prefetch={false} href={exploreHref(query, offset + PAGE_SIZE)} className={BUTTON}>Next<ArrowRight aria-hidden className="size-4" /></Link> : <span />}
          </nav>
        )}
      </section>
    </>
  );
}

// Shaped like the cards it stands in for, so nothing jumps when they arrive
function ResultsSkeleton({ featured }: { featured: boolean }) {
  return (
    <div role="status" aria-label="Loading public Spaces">
      <div className="mb-6 h-8 w-44 rounded-lg bg-landing-ink/[0.06] motion-safe:animate-pulse" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: featured ? 3 : 6 }, (_, i) => (
          <div key={i} className={cn("overflow-hidden rounded-2xl border border-landing-ink/10 bg-landing-ink/[0.03] motion-safe:animate-pulse", featured && i === 0 && "sm:col-span-2 lg:row-span-2")}>
            <div className="aspect-[8/5] bg-landing-ink/[0.06]" />
            <div className="p-6">
              <div className="h-5 w-2/3 rounded-lg bg-landing-ink/[0.06]" />
              <div className="mt-3 h-4 w-full rounded-lg bg-landing-ink/[0.06]" />
              <div className="mt-6 h-3 w-1/2 rounded-lg bg-landing-ink/[0.06]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function PublicSpacesPage({ searchParams }: { searchParams: Promise<{ q?: string; offset?: string }> }) {
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q.slice(0, 120).trim() : "";
  const offset = exploreOffset(typeof search.offset === "string" ? search.offset : undefined);
  const billing = await isFeatureEnabled("billing");
  return (
    <>
      <SiteNav onHome={false} />
      <main id="main" className="px-4 pt-32 pb-24 sm:px-6">
        <div className="mx-auto max-w-[680px] text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Explore public Spaces</h1>
          <p className="mt-4 text-lg text-landing-ink/60 text-pretty">Read wikis their owners chose to share.</p>
          <form action="/explore" role="search" className="mt-8 flex items-center gap-2 rounded-2xl border border-landing-ink/15 bg-landing-ink/[0.03] p-2 transition-colors duration-300 ease-landing focus-within:border-landing-gold">
            <label htmlFor="explore-search" className="sr-only">Search public Spaces and articles</label>
            <MagnifyingGlass aria-hidden className="ml-2 size-5 shrink-0 text-landing-ink/50" />
            <input
              // Remounts on a new search, so the box always shows what the URL asked for
              key={query}
              id="explore-search"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              name="q"
              defaultValue={query}
              maxLength={120}
              placeholder="Search topics or article text"
              className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-landing-ink/50"
            />
            {query && (
              <Link href="/explore" aria-label="Clear search" className={cn("grid size-10 shrink-0 place-items-center rounded-lg text-landing-ink/50 transition-colors duration-300 ease-landing hover:bg-landing-ink/10 hover:text-landing-ink", FOCUS)}>
                <X aria-hidden className="size-4" />
              </Link>
            )}
            <button type="submit" className={cn("shrink-0 rounded-lg bg-landing-green px-3 py-2 text-sm font-semibold text-white transition duration-300 ease-landing hover:bg-landing-green-hover active:scale-[0.98]", FOCUS)}>
              Search
            </button>
          </form>
        </div>
        <div className="mx-auto mt-16 max-w-6xl">
          <Suspense key={`${query}:${offset}`} fallback={<ResultsSkeleton featured={!query && offset === 0} />}>
            <Results query={query} offset={offset} />
          </Suspense>
        </div>
      </main>
      <LandingFooter hasContact={contactEmail() !== null} pricing={billing} onHome={false} />
    </>
  );
}
