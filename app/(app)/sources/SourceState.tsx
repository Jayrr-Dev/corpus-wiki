"use client";

import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { SOURCE_STATE_TONE } from "@/app/(app)/_lib/tone";
import { Tooltip } from "@/components/standard/tooltip";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";

export function SourceState({ source }: { source: Tables<"sources"> }) {
  const state = sourceState(source);
  const badge = <StatusDot tone={SOURCE_STATE_TONE[state]} label={state} />;
  if (state === "active") return badge;
  return <Tooltip content={source.archive_reason?.trim() || "Archived before reasons were recorded."} className="max-w-md whitespace-pre-wrap"><span tabIndex={0} className="inline-flex cursor-help">{badge}</span></Tooltip>;
}
