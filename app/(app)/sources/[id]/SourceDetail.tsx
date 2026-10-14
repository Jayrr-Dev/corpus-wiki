"use client";

import { Facts, Note, QueryState, Section } from "@/app/(app)/_components/bits";
import { formatDate, formatDateTime } from "@/app/(app)/_lib/format";
import type { Tables } from "@/lib/database/types";
import { useSource } from "@/lib/queries";
import { SourcePassages } from "./SourcePassages";

// SOURCE DETAIL: what the file is, then its passages
export function SourceDetail({ sourceId }: { sourceId: string }) {
  const query = useSource(sourceId);
  const source = query.data;
  return (
    <QueryState query={query}>
      {source ? (
        <div className="flex flex-col gap-6">
          <SourceHeader source={source} />
          <SourcePassages sourceId={source.id} />
        </div>
      ) : (
        <Note>No source with this id.</Note>
      )}
    </QueryState>
  );
}

// HEADER: title, dates and type
function SourceHeader({ source }: { source: Tables<"sources"> }) {
  return (
    <Section title="File">
      <p className="text-body font-medium">{source.title}</p>
      <Facts
        items={[
          ["Source date", <span key="date" className="font-mono">{formatDate(source.source_date)}</span>],
          ["Uploaded", <span key="uploaded" className="font-mono">{formatDateTime(source.created_at)}</span>],
          ["Type", <span key="type" className="font-mono">{source.mime_type}</span>],
        ]}
      />
    </Section>
  );
}
