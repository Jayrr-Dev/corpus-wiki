"use client";

import type { Enums } from "@/lib/database/types";
import { useActorLabel, usePersonName } from "@/app/(app)/_lib/useActorLabel";
import { uploaderLabel } from "@/app/(app)/_lib/uploaderLabel";

// WHO MADE IT, for table cells: "Sam", or "AI · <model>"
export function ActorName({ kind, personId, model }: { kind: Enums<"actor_kind">; personId: string | null | undefined; model: string | null | undefined }) {
  const label = useActorLabel();
  return <span className="whitespace-nowrap">{label(kind, personId, model)}</span>;
}

// WHO UPLOADED IT: AI, the person on the upload event, "API key" for a capture, or a dash
export function UploaderName({ event }: { event: { person_id: string | null; via: string | null; actor?: Enums<"actor_kind"> } | null | undefined }) {
  const name = usePersonName(event?.person_id);
  const text = uploaderLabel(event, name);
  return text ? <span className="whitespace-nowrap">{text}</span> : <span className="text-faint">—</span>;
}
