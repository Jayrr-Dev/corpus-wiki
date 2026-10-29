"use client";

import { Fragment, type ReactNode } from "react";
import { PatchedText } from "./PatchedText";
import { type ArticleLink } from "@/lib/living-page/articleEvidence";
import { type DocBlock, type DocInnerBlock, type DocStep, parseDocBlock } from "@/lib/docs/blocks";

// =====================================================================
// DOC LINE: a Docs section line (one doc block as JSON, lib/docs/blocks.ts)
// drawn in the article view. Citations and the details button (`trailing`)
// end the block's last words, as on a prose paragraph.
// =====================================================================

export function DocLine({ content, links = [], trailing }: { content: string; links?: ArticleLink[]; trailing?: ReactNode }) {
  return <DocBlockPart block={parseDocBlock(content)} links={links} trailing={trailing} />;
}

function DocBlockPart({ block, links, trailing }: { block: DocBlock; links: ArticleLink[]; trailing: ReactNode }) {
  switch (block.type) {
    case "text":
      return <p className="text-body leading-7"><PatchedText text={block.text} links={links} />{trailing}</p>;
    case "heading":
      return <h3 className="font-serif text-xl">{block.text}{trailing}</h3>;
    case "steps":
      return <Steps steps={block.steps} links={links} trailing={trailing} />;
    case "prereqs":
      return (
        <div className="text-body leading-7">
          <p className="font-semibold">Prerequisites</p>
          <ul className="list-disc space-y-1 pl-6">{block.items.map((item, index) => <li key={index} className="pl-1"><PatchedText text={item.text} links={links} />{index === block.items.length - 1 ? trailing : null}</li>)}</ul>
        </div>
      );
    case "code":
      return <div><pre className="overflow-x-auto rounded-md border bg-hover/60 p-3 text-sm"><code>{block.code}</code></pre><p className="text-body leading-7">{trailing}</p></div>;
    case "params":
      return (
        <dl className="space-y-1 text-body leading-7">
          {block.params.map((param, index) => <div key={index}><dt className="inline font-mono text-sm">{param.name}</dt>: <dd className="inline"><PatchedText text={param.description} links={links} />{index === block.params.length - 1 ? trailing : null}</dd></div>)}
        </dl>
      );
    case "callout":
      return <p className="rounded-md border-l-2 border-link bg-hover/60 px-4 py-2 text-body leading-7"><span className="font-semibold">{block.tone === "warning" ? "Warning: " : "Tip: "}</span><PatchedText text={block.text} links={links} />{trailing}</p>;
    case "tabs":
      return (
        <div className="space-y-3">
          {block.tabs.map((tab, index) => (
            <Fragment key={index}>
              <p className="text-panel font-semibold">{tab.label}</p>
              {tab.blocks.map((inner: DocInnerBlock, innerIndex) => <DocBlockPart key={innerIndex} block={inner} links={links} trailing={index === block.tabs.length - 1 && innerIndex === tab.blocks.length - 1 ? trailing : null} />)}
            </Fragment>
          ))}
        </div>
      );
  }
}

function Steps({ steps, links, trailing }: { steps: DocStep[]; links: ArticleLink[]; trailing: ReactNode }) {
  return (
    <ol className="list-decimal space-y-1 pl-6 text-body leading-7">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={index} className="pl-1">
            <PatchedText text={step.text} links={links} />
            {step.substeps?.length ? <Steps steps={step.substeps} links={links} trailing={last ? trailing : null} /> : last ? trailing : null}
          </li>
        );
      })}
    </ol>
  );
}
