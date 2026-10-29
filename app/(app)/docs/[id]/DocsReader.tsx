"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PublishingDialog } from "@/components/publishing/PublishingDialog";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { claimsByUnit, pageHeadings, pageTree, readerSections, subtaskAnchor } from "@/lib/docs/reader";
import { type DocSetView, isPageStale, isPageWriting } from "@/lib/docs/types";
import { cn } from "@/lib/utils";
import { DocBlockView } from "./DocBlockView";

// =====================================================================
// DOCS READER: page tree on the left, the page in the center, "On this
// page" on the right; Rebuild, Export and Publish in the top bar. A page
// whose sources changed shows a dot in the tree and "Sources changed"
// with Rebuild page. Refreshes itself while pages are being written.
// =====================================================================

export function DocsReader({ set, pageId }: { set: DocSetView; pageId: string | null }) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [rebuilding, setRebuilding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const page = set.pages.find((item) => item.id === pageId) ?? null;
  const claims = useMemo(() => claimsByUnit(set), [set]);
  const sections = useMemo(() => (page ? readerSections(page) : []), [page]);
  const headings = pageHeadings(sections);
  const writing = set.status === "writing" || set.pages.some(isPageWriting);

  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [writing, router]);

  const rebuild = async (target: string) => {
    setRebuilding(target); setError(null);
    try {
      const response = await fetch(`/api/docs/${set.id}/rebuild`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target === "all" ? {} : { pageId: target }) });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!result.ok) setError(result.error ?? "Could not rebuild.");
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRebuilding(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/docs" className="text-panel text-muted-foreground hover:underline">Docs</Link>
          <h1 className="truncate text-title font-semibold">{set.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={writing || rebuilding !== null} onClick={() => rebuild("all")}>{writing ? "Writing…" : "Rebuild"}</Button>
          <Button size="sm" variant="outline" asChild><a href={`/api/docs/${set.id}/export`} download>Export</a></Button>
          <Button size="sm" variant="outline" onClick={() => setPublishing(true)}>Publish</Button>
        </div>
      </header>
      {set.status === "failed" && set.error ? <p role="alert" className="text-panel text-destructive">{set.error}</p> : null}
      {error ? <p role="alert" className="text-panel text-destructive">{error}</p> : null}

      <div className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_12rem]">
        <nav aria-label="Pages" className="md:sticky md:top-4 md:self-start">
          {pageTree(set.pages).map((group) => (
            <div key={group.label ?? "pages"} className="mb-4">
              {group.label ? <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">{group.label}</p> : null}
              <ul className="grid gap-0.5">
                {group.pages.map((item) => (
                  <li key={item.id}>
                    <Link href={`/docs/${set.id}?page=${item.id}`} aria-current={item.id === page?.id ? "page" : undefined}
                      className={cn("flex items-center justify-between gap-2 rounded-md px-2 py-1 text-panel hover:bg-muted", item.id === page?.id && "bg-muted font-medium")}>
                      <span className="truncate">{item.title}</span>
                      {isPageStale(item) ? (
                        <Tooltip content="Sources changed">
                          <span aria-label="Sources changed" className="size-2 shrink-0 rounded-full bg-destructive" />
                        </Tooltip>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <article className="min-w-0">
          {page ? (
            <div className="grid gap-4">
              <h2 className="text-2xl font-semibold">{page.title}</h2>
              {isPageStale(page) ? (
                <div className="flex flex-wrap items-center gap-3 text-panel">
                  <span className="text-destructive">Sources changed</span>
                  <Button size="sm" variant="outline" disabled={writing || rebuilding !== null} onClick={() => rebuild(page.id)}>Rebuild page</Button>
                </div>
              ) : null}
              {isPageWriting(page) ? <p className="text-panel text-muted-foreground">Writing this page…</p> : null}
              {sections.map((section) => (
                <section key={section.id} aria-labelledby={section.intro ? undefined : section.anchor} className="grid gap-3">
                  {section.intro ? null : <h2 id={section.anchor} className="scroll-mt-20 pt-4 text-xl font-semibold">{section.title}</h2>}
                  {section.blocks.map(({ key, block }) => <DocBlockView key={key} block={block} claims={claims} anchor={block.type === "heading" ? subtaskAnchor(key) : undefined} />)}
                </section>
              ))}
            </div>
          ) : (
            <p className="text-panel text-muted-foreground">No pages yet.</p>
          )}
        </article>

        <aside aria-label="On this page" className="hidden xl:sticky xl:top-4 xl:block xl:self-start">
          {headings.length ? (
            <>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">On this page</p>
              <ul className="grid gap-1 text-panel">
                {headings.map((heading) => (
                  <li key={heading.anchor} className={heading.level === 3 ? "pl-3" : undefined}>
                    <a href={`#${heading.anchor}`} className="text-muted-foreground hover:text-foreground">{heading.text}</a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
      <PublishingDialog open={publishing} onOpenChange={setPublishing} />
    </div>
  );
}
