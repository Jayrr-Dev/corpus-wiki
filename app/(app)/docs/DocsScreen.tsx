"use client";

import { FileCode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/database/types";
import { docsTopicNav, topicNavSetIds } from "@/lib/docs/topicNav";
import { docsTree } from "@/lib/docs/tree";
import type { DocSetSummary } from "@/lib/docs/types";
import type { Scope, ScopeOptions } from "@/lib/knowledge/scopeTypes";
import { DocsTopicNav } from "./DocsTopicNav";
import { DocsTree } from "./DocsTree";
import { NewDocsDialog } from "./NewDocsDialog";

// DOCS LIST: the topic bar, then every set on the topic tree (DocsTree), like the Study list
export function DocsScreen({ sets, options, domains, topic, startTopic }: {
  sets: DocSetSummary[]; options: ScopeOptions; domains: Tables<"domains">[]; topic: string | null; startTopic: string | null;
}) {
  const router = useRouter();
  // New docs from the topic bar arrives as ?new=<topic id>; the dialog opens on that topic
  const [creating, setCreating] = useState(startTopic !== null);
  const startScope: Scope | null = startTopic && options.topic.some((option) => option.id === startTopic) ? { kind: "topic", id: startTopic } : null;
  const openCreating = (next: boolean) => {
    setCreating(next);
    if (!next && startTopic !== null) router.replace("/docs");
  };
  const nav = useMemo(() => docsTopicNav(sets, options), [sets, options]);
  // ?topic= from the topic bar's Overview; an unknown topic shows everything
  const topicIds = topic ? topicNavSetIds(nav, topic) : null;
  const shown = topicIds ? sets.filter((set) => topicIds.has(set.id)) : sets;
  const tree = docsTree(domains, shown);
  const writing = sets.some((set) => set.status === "writing");

  // Sets being written update on their own
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [writing, router]);

  return (
    <ReadingPane title="Docs" actions={<Button size="sm" variant="outline" onClick={() => setCreating(true)}>New docs</Button>}>
      <DocsTopicNav items={nav} activeKey={topicIds ? topic : null} />
      {shown.length ? (
        <DocsTree roots={tree.roots} other={tree.other} />
      ) : (
        <EmptyState icon={FileCode} title="No docs yet." />
      )}
      <NewDocsDialog open={creating} onOpenChange={openCreating} options={options} initialScope={startScope} />
    </ReadingPane>
  );
}
