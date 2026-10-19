import { LineBlock } from "@/components/living-page/LineBlock";
import type { WikiBody } from "@/lib/publishing/types";

// No workspace hooks, source links, controls, IDs or raw HTML. Even strings
// resembling HTML or Markdown links are rendered as text by LineBlock.
export function WikiArticle({ body }: { body: WikiBody }) {
  return <article className="min-w-0 break-words">
    <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{body.title}</h1>
    {body.sections.length > 1 && <nav aria-label="On this page" className="my-6 border-l-2 pl-4">
      <p className="mb-2 text-sm font-medium">On this page</p>
      <ul className="space-y-1 text-sm">{body.sections.map((s, i) => <li key={i}><a href={`#section-${i}`} className="text-link hover:underline">{s.title}</a></li>)}</ul>
    </nav>}
    <div className="mt-8 space-y-10">{body.sections.map((section, i) => <section key={i} id={`section-${i}`} className="scroll-mt-6">
      <h2 className="mb-4 border-b pb-2 font-serif text-2xl">{section.title}</h2>
      <div className="space-y-4">{section.lines.map((line, n) => <LineBlock key={n} content={line} />)}</div>
    </section>)}</div>
  </article>;
}
