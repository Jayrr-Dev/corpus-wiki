"use client";

import { AlertTriangle, Lightbulb } from "lucide-react";
import { createContext, useContext, useMemo, useState } from "react";
import { type DocBlock, type DocInnerBlock, type DocStep, docBlockCites } from "@/lib/docs/blocks";
import type { DocClaimRow } from "@/lib/docs/types";
import { cn } from "@/lib/utils";

// =====================================================================
// DOC BLOCKS IN THE READER: numbered steps, Prerequisites, code with its
// <placeholders> and parameter list, Tip and Warning callouts, and
// interface tabs. Each cited piece gets a numbered note like Wikipedia's;
// CitationScope lists the notes at the end of the page.
// =====================================================================

type Claims = ReadonlyMap<string, DocClaimRow>;

// The numbers of one page's notes, keyed by claim (unit id). The prefix keeps note ids unique on a page.
type CitationScope = { prefix: string; numbers: ReadonlyMap<string, number> };
const CitationContext = createContext<CitationScope>({ prefix: "", numbers: new Map() });

// A cited piece ends with its note numbers, like [1]; a click jumps to the note
function Cited({ cites, claims, children, block = false }: { cites: string[]; claims: Claims; children: React.ReactNode; block?: boolean }) {
  const { prefix, numbers } = useContext(CitationContext);
  const Tag = block ? "div" : "span";
  const found = cites.flatMap((id) => claims.get(id) ?? []);
  if (!found.length) return <Tag>{children}</Tag>;
  return (
    <Tag>
      {children}
      {found.map((claim) => (
        <sup key={claim.unitId} className="ml-0.5 text-panel">
          <a href={`#${prefix}-note-${numbers.get(claim.unitId)}`} className="text-link">[{numbers.get(claim.unitId)}]</a>
        </sup>
      ))}
    </Tag>
  );
}

// The notes of one page: each claim gets a number in reading order, and the list of notes sits at the end
export function CitationScope({ prefix, blocks, claims, children }: { prefix: string; blocks: DocBlock[]; claims: Claims; children: React.ReactNode }) {
  const order = useMemo(() => [...new Set(blocks.flatMap(docBlockCites))].filter((id) => claims.has(id)), [blocks, claims]);
  const numbers = useMemo(() => new Map(order.map((id, index) => [id, index + 1])), [order]);
  const scope = useMemo(() => ({ prefix, numbers }), [prefix, numbers]);
  return (
    <CitationContext.Provider value={scope}>
      {children}
      {order.length ? (
        <section aria-label="References" className="grid gap-2 border-t pt-4 text-panel">
          <p className="font-semibold">References</p>
          <ol className="grid gap-1.5">
            {order.map((id) => {
              const claim = claims.get(id)!;
              return (
                <li key={id} id={`${prefix}-note-${numbers.get(id)}`} className="scroll-mt-20 flex gap-2">
                  <span className="text-muted-foreground">{numbers.get(id)}.</span>
                  <span>{claim.title ? <strong>{claim.title}: </strong> : null}{claim.content}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </CitationContext.Provider>
  );
}

// Code with <placeholders> marked so they stand out
function Code({ code, language }: { code: string; language: string }) {
  const parts = code.split(/(<[A-Za-z][\w.-]*>)/g);
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/50 px-4 py-3 text-xs leading-relaxed" data-language={language || undefined}>
      <code>{parts.map((part, index) => (/^<[A-Za-z][\w.-]*>$/.test(part) ? <span key={index} className="text-link">{part}</span> : part))}</code>
    </pre>
  );
}

function Steps({ steps, claims, nested = false }: { steps: DocStep[]; claims: Claims; nested?: boolean }) {
  return (
    <ol className={cn("grid gap-2", nested ? "mt-2 list-disc pl-5" : "list-decimal pl-6")}>
      {steps.map((step, index) => (
        <li key={index} className="pl-1">
          <Cited cites={step.cites} claims={claims}>{step.text}</Cited>
          {step.substeps?.length ? <Steps steps={step.substeps} claims={claims} nested /> : null}
        </li>
      ))}
    </ol>
  );
}

function Inner({ block, claims, anchor }: { block: DocInnerBlock; claims: Claims; anchor?: string }) {
  switch (block.type) {
    case "text": return <p className="leading-relaxed"><Cited cites={block.cites} claims={claims}>{block.text}</Cited></p>;
    case "heading": return <h3 id={anchor} className="scroll-mt-20 pt-2 text-base font-semibold">{block.text}</h3>;
    case "steps": return <Steps steps={block.steps} claims={claims} />;
    case "prereqs": return (
      <div className="rounded-lg border px-4 py-3">
        <p className="font-medium">Prerequisites</p>
        <ul className="mt-1 list-disc pl-5">{block.items.map((item, index) => <li key={index}><Cited cites={item.cites} claims={claims}>{item.text}</Cited></li>)}</ul>
      </div>
    );
    case "code": return <Cited cites={block.cites} claims={claims} block><Code code={block.code} language={block.language} /></Cited>;
    case "params": return (
      <dl className="grid gap-1.5">
        {block.params.map((param) => (
          <div key={param.name} className="flex flex-wrap gap-x-2">
            <dt><code className="rounded bg-muted px-1 text-xs">{param.name}</code></dt>
            <dd><Cited cites={param.cites} claims={claims}>{param.description}</Cited></dd>
          </div>
        ))}
      </dl>
    );
    case "callout": {
      const warning = block.tone === "warning";
      const Icon = warning ? AlertTriangle : Lightbulb;
      return (
        <div className={cn("flex gap-2 rounded-lg border px-4 py-3", warning ? "border-destructive/40 bg-destructive/5" : "border-link/30 bg-link/5")}>
          <Icon className={cn("mt-0.5 size-4 shrink-0", warning ? "text-destructive" : "text-link")} />
          <p><strong>{warning ? "Warning" : "Tip"}:</strong> <Cited cites={block.cites} claims={claims}>{block.text}</Cited></p>
        </div>
      );
    }
  }
}

// Interface tabs: one way per tab (shown only when the sources describe several)
function Tabs({ tabs, claims }: { tabs: Extract<DocBlock, { type: "tabs" }>["tabs"]; claims: Claims }) {
  const [active, setActive] = useState(0);
  const tab = tabs[Math.min(active, tabs.length - 1)]!;
  return (
    <div className="rounded-lg border">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b px-2">
        {tabs.map((item, index) => (
          <button key={item.label} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-panel", index === active ? "border-link font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="grid gap-3 px-4 py-3">
        {tab.blocks.map((inner, index) => <Inner key={index} block={inner} claims={claims} />)}
      </div>
    </div>
  );
}

export function DocBlockView({ block, claims, anchor }: { block: DocBlock; claims: Claims; anchor?: string }) {
  if (block.type === "tabs") return <Tabs tabs={block.tabs} claims={claims} />;
  return <Inner block={block} claims={claims} anchor={anchor} />;
}
