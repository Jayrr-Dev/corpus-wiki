"use client";

import { FileCode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocSetSummary } from "@/lib/docs/types";
import type { ScopeOptions } from "@/lib/knowledge/scopeTypes";
import { scopeName, shortDate } from "./format";
import { NewDocsDialog } from "./NewDocsDialog";

// DOCS LIST: each set with its scope, page count, last update and a badge when pages need a rebuild
export function DocsScreen({ sets, options }: { sets: DocSetSummary[]; options: ScopeOptions }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const writing = sets.some((set) => set.status === "writing");

  // Sets being written update on their own
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [writing, router]);

  return (
    <ReadingPane title="Docs" actions={<Button size="sm" variant="outline" onClick={() => setCreating(true)}>New docs</Button>}>
      {sets.length ? (
        <ul className="grid gap-3">
          {sets.map((set) => (
            <li key={set.id} className="rounded-xl border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link href={`/docs/${set.id}`} className="truncate font-medium hover:underline">{set.title}</Link>
                  <Badge variant="outline">{scopeName(set, options)}</Badge>
                  {set.status === "writing" ? <Badge variant="secondary">Writing…</Badge> : null}
                  {set.stalePages ? <Badge variant="destructive">Sources changed</Badge> : null}
                </div>
                <p className="text-panel text-muted-foreground">
                  {set.pageCount} page{set.pageCount === 1 ? "" : "s"} · Updated {shortDate(set.updatedAt)}
                </p>
              </div>
              {set.status === "failed" && set.error ? <p role="alert" className="mt-1 text-panel text-destructive">{set.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={FileCode} title="No docs yet." />
      )}
      <NewDocsDialog open={creating} onOpenChange={setCreating} options={options} />
    </ReadingPane>
  );
}
