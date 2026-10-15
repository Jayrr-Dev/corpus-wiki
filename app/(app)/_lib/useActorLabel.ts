"use client";

import { useCallback, useMemo } from "react";
import type { Enums } from "@/lib/database/types";
import { useProfiles } from "@/lib/queries";
import { actorLabel } from "./format";

export type ActorLabel = (kind: Enums<"actor_kind">, personId: string | null | undefined, model: string | null | undefined) => string;

// WHO MADE A CHANGE, by current name: rows store the person's profile id (or the AI's
// model), and the profiles list (a handful of rows, cached) turns the id into a name
export function useActorLabel(): ActorLabel {
  const profiles = useProfiles().data;
  const names = useMemo(() => new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name || profile.email])), [profiles]);
  return useCallback((kind, personId, model) => actorLabel(kind, personId ? names.get(personId) : null, model), [names]);
}

// A person's current name by profile id (uploaders, who answered an exception), or null
export function usePersonName(personId: string | null | undefined): string | null {
  const profiles = useProfiles().data;
  const profile = profiles?.find((candidate) => candidate.id === personId);
  return profile ? profile.display_name || profile.email : null;
}
