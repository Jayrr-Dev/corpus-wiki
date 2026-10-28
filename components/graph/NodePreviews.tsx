"use client";

import Link from "next/link";
import { Facts, QueryState } from "@/app/(app)/_components/bits";
import { formatDate } from "@/app/(app)/_lib/format";
import { Button } from "@/components/ui/button";
import type { GraphNode } from "@/lib/graph";
import { useEntity, usePage, useSections, useSectionLines } from "@/lib/queries";
import type { ReactNode } from "react";

// FOOTER: the actions strip along a preview card's bottom edge
export function PreviewFooter({ children }: { children: ReactNode }) {
  return <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">{children}</div>;
}

function PreviewHeader({ node, kind }: { node: GraphNode; kind: string }) {
  return <div data-drag-handle className="flex cursor-move flex-col gap-2 pr-6"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{kind}</p><h2 className="text-body leading-none font-medium">{node.label}</h2></div>;
}

function OpenPage({ node }: { node: GraphNode }) {
  return <PreviewFooter><Button asChild><Link href={node.href}>Open page</Link></Button></PreviewFooter>;
}

export function EntityPreview({ node }: { node: GraphNode }) {
  const query = useEntity(node.id);
  const entity = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PreviewHeader node={node} kind="Entity" />
      <QueryState query={query}>
        {entity ? <>
          <p className="text-body whitespace-pre-wrap">{entity.description || "No description yet."}</p>
          <Facts items={[
            ["Type", entity.type],
            ...(entity.aliases.length ? [["Aliases", entity.aliases.join(", ")] as [string, string]] : []),
            ["Connections", node.degree],
            ["Created", formatDate(entity.created_at)],
          ]} />
        </> : <p className="text-muted-foreground">This entity is no longer available.</p>}
      </QueryState>
      <OpenPage node={node} />
    </div>
  );
}

export function PagePreview({ node }: { node: GraphNode }) {
  const query = usePage(node.id);
  const sections = useSections({ filters: { page_id: node.id } });
  const lines = useSectionLines(node.id);
  return (
    <div className="flex flex-col gap-4">
      <PreviewHeader node={node} kind="Article" />
      <QueryState query={query}>
        {query.data ? <>
          <QueryState query={sections}>
            <QueryState query={lines}>
              {sections.data?.length ? sections.data.map((section) => {
                const content = (lines.data ?? []).filter((line) => line.sectionId === section.id).map((line) => line.content).join("\n\n") || section.body;
                return <section key={section.id} className="flex flex-col gap-2"><h3 className="font-medium">{section.title}</h3><p className="text-body whitespace-pre-wrap">{content || "No content yet."}</p></section>;
              }) : <p className="text-muted-foreground">No content yet.</p>}
            </QueryState>
          </QueryState>
          <Facts items={[
            ...(node.domainPaths.length ? [["Domains", node.domainPaths.join(", ")] as [string, string]] : []),
            ["Connections", node.degree],
            ["Created", formatDate(query.data.created_at)],
          ]} />
        </> : <p className="text-muted-foreground">This article is no longer available.</p>}
      </QueryState>
      <OpenPage node={node} />
    </div>
  );
}
