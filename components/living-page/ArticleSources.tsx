import Link from "next/link";
import { formatReferencePages, type ArticleReference } from "@/lib/living-page/articleEvidence";
import { Loader } from "@/components/standard/loader";

function backlinkLabel(index: number): string {
  let label = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(97 + ((value - 1) % 26)) + label;
  return label;
}

export function ArticleSources({ references, loading, error }: { references: ArticleReference[]; loading: boolean; error?: string }) {
  return (
    <section id="article-sources" className="scroll-mt-6 border-t pt-5">
      <h2 className="mb-3 font-serif text-2xl">References</h2>
      {error ? <p role="alert" className="text-panel">References could not be loaded: {error}</p> : null}
      {loading ? <Loader inline label="Loading references…" /> : null}
      {!loading && !error && !references.length ? <p className="text-panel text-faint">No source passages are attached to these paragraphs yet.</p> : null}
      <ol className="list-decimal space-y-3 pl-5 text-panel marker:text-faint">
        {references.map((reference) => {
          const pages = reference.passages.flatMap((passage) => passage.page === null ? [] : [passage.page]);
          return (
            <li key={reference.sourceId} id={`reference-${reference.number}`} className="scroll-mt-6 pl-1 target:bg-hover">
              <span className="mr-2 inline-flex flex-wrap gap-1 text-xs">
                <span aria-hidden>↑</span>
                {reference.backlinks.map((backlink, index) => <a key={backlink.anchorId} href={`#${backlink.anchorId}`} aria-label={`Back to citation ${reference.number}${backlinkLabel(index)}`} className="text-link hover:underline">{backlinkLabel(index)}</a>)}
              </span>
              <Link href={`/sources/${reference.sourceId}`} className="text-link hover:underline"><cite className="not-italic">{reference.title}</cite></Link>
              <span className="text-muted-foreground">. {reference.date.slice(0, 10)}{pages.length ? `. Cited pages ${formatReferencePages(pages)}` : ""}.</span>
              <details className="mt-1 text-muted-foreground">
                <summary className="cursor-pointer text-xs">Evidence ({reference.passages.length} cited passages)</summary>
                <ol className="mt-3 space-y-3">
                  {reference.passages.map((passage) => <li key={passage.id} className="border-l-2 pl-3">
                    <Link href={`/sources/${reference.sourceId}#passage-${passage.id}`} className="text-xs text-link hover:underline">{passage.page === null ? "View passage" : `Page ${passage.page}`}</Link>
                    <blockquote className="mt-1">{passage.quote}</blockquote>
                  </li>)}
                </ol>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
