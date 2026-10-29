"use server";
import type { DraftAction, SectionQuery } from "@/lib/ai/types";
import { currentActor } from "@/lib/auth/currentPerson";
import { requireUser } from "@/lib/auth/requireUser";
import { commitPersonEdit } from "@/lib/change-control";
import type { Json } from "@/lib/database/types";
import { supabaseRpc } from "@/lib/db/rpc";
import type { PageDrop } from "@/lib/graph/clusters";
import {
  canPinClaim,
  placeClaimEdits,
  releaseSuggestionUnit,
  suggestionMembership,
  suggestionSections,
  type ClaimSection,
  type PinnedQuery,
  type SuggestionGroup,
} from "@/lib/graph/pageDrop";
import { refreshSectionStyle } from "@/lib/living-page/refreshStyle";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase, type AdminSupabase } from "@/lib/supabase/admin";
import { z } from "zod";
import { toActionResult } from "./result";

export async function moveGraphClaim(
  unitId: string,
  sourcePath: string,
  destinationPath: string,
) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(unitId);
    const client = getAdminSupabase();
    const [unit, memberships, domains] = await Promise.all([
      client
        .from("units")
        .select("current_revision_id")
        .eq("id", unitId)
        .is("retired_at", null)
        .single(),
      client.from("unit_domains").select("domain_id").eq("unit_id", unitId),
      client.from("domains").select("id,path").is("retired_at", null),
    ]);
    for (const result of [unit, memberships, domains])
      if (result.error) throw new Error(result.error.message);
    const paths = domains
      .data!.filter((d) => memberships.data!.some((m) => m.domain_id === d.id))
      .map((d) => d.path);
    if (sourcePath && !paths.includes(sourcePath))
      throw new Error("Membership changed. Reopen the menu.");
    if (!domains.data!.some((d) => d.path === destinationPath))
      throw new Error("Choose an existing domain.");
    const result = await commitPersonEdit(
      supabaseRpc(client),
      "Move graph claim to " + destinationPath,
      [
        {
          type: "place_claim",
          targetId: unitId,
          expectedRevisionId: unit.data!.current_revision_id,
          passageIds: [],
          speechAct: null,
          input: {
            domainPaths: [
              ...new Set([
                ...paths.filter((p) => p !== sourcePath),
                destinationPath,
              ]),
            ],
            rationale: "Moved by the user from the graph.",
          },
        },
      ],
    );
    if (result.status !== "applied")
      throw new Error("Move was not applied. Check Changes for details.");
    return { changeSetId: result.changeSetId };
  });
}

export async function setGraphLinkRemoved(
  unitId: string,
  linkId: string,
  removed: boolean,
) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(unitId);
    z.uuid().parse(linkId);
    z.boolean().parse(removed);
    const client = getAdminSupabase();
    const { data: link, error } = await client
      .from("relationships")
      .select("*")
      .eq("id", linkId)
      .single();
    if (error) throw new Error(error.message);
    if (link.from_unit_id !== unitId && link.to_unit_id !== unitId)
      throw new Error("Link does not belong to this node.");
    if (!removed) {
      const endpoints = await client
        .from("units")
        .select("id")
        .in("id", [link.from_unit_id, link.to_unit_id])
        .is("retired_at", null);
      if (endpoints.error) throw new Error(endpoints.error.message);
      if (endpoints.data.length !== 2)
        throw new Error("Cannot restore a link to a retired claim.");
      const duplicate = await client
        .from("relationships")
        .select("id")
        .eq("from_unit_id", link.from_unit_id)
        .eq("to_unit_id", link.to_unit_id)
        .eq("type", link.type)
        .is("retired_at", null)
        .neq("id", linkId);
      if (duplicate.error) throw new Error(duplicate.error.message);
      if (duplicate.data.length)
        throw new Error("An active link already exists.");
    }
    const input = {
      type: link.type,
      toUnitId: link.to_unit_id,
      graphLinkId: link.id,
      removed,
      expectedRetiredAt: link.retired_at,
    };
    const result = await commitPersonEdit(
      supabaseRpc(client),
      removed ? "Remove link" : "Restore link",
      [
        {
          type: "link",
          targetId: link.from_unit_id,
          expectedRevisionId: null,
          passageIds: [],
          speechAct: null,
          input,
        },
      ],
    );
    if (result.status !== "applied")
      throw new Error("Link changed. Refresh and try again.");
    return { changeSetId: result.changeSetId };
  });
}

export async function organizeGraphSelection(
  unitIds: string[],
  destinationPath: string,
  newName = "",
) {
  return toActionResult(async () => {
    await requireUser();
    const ids = [...new Set(z.array(z.uuid()).min(1).max(300).parse(unitIds))];
    destinationPath = z.string().trim().min(1).max(2000).parse(destinationPath);
    newName = z
      .string()
      .trim()
      .max(100)
      .refine(
        (n) => !n.includes("/") && n !== "." && n !== "..",
        "Use a single domain name.",
      )
      .parse(newName);
    const client = getAdminSupabase();
    const [units, parent] = await Promise.all([
      client
        .from("units")
        .select("id,current_revision_id")
        .in("id", ids)
        .is("retired_at", null),
      client
        .from("domains")
        .select("id")
        .eq("path", destinationPath)
        .is("retired_at", null)
        .single(),
    ]);
    if (units.error) throw new Error(units.error.message);
    if (parent.error)
      throw new Error("Choose an existing destination or parent domain.");
    if (units.data.length !== ids.length)
      throw new Error(
        "Some selected claims are no longer active. Select again.",
      );
    const path = newName ? destinationPath + "/" + newName : destinationPath;
    if (newName) {
      const existing = await client
        .from("domains")
        .select("id")
        .eq("path", path);
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data.length)
        throw new Error("That domain already exists. Choose Move instead.");
    }
    const actions: import("@/lib/ai/types").DraftAction[] = [];
    if (newName)
      actions.push({
        type: "create_domain",
        targetId: null,
        expectedRevisionId: null,
        passageIds: [],
        speechAct: null,
        input: { name: newName, path, parentPath: destinationPath },
      });
    actions.push(
      ...units.data.map((unit) => ({
        type: "place_claim" as const,
        targetId: unit.id,
        expectedRevisionId: unit.current_revision_id,
        passageIds: [],
        speechAct: null,
        input: {
          domainPaths: [path],
          rationale: "Moved by the user from a graph selection.",
        },
      })),
    );
    const result = await commitPersonEdit(
      supabaseRpc(client),
      `Organize ${ids.length} selected claims in ${path}`,
      actions,
    );
    return {
      changeSetId: result.changeSetId,
      status: result.status,
      applied: result.applied,
      total: actions.length,
    };
  });
}

const pageDropSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("article"),
    page: z.string().trim().min(1).max(300),
  }),
  z.object({
    kind: z.literal("section"),
    page: z.string().trim().min(1).max(300),
    section: z.string().trim().min(1).max(200),
  }),
  z.object({
    kind: z.literal("suggestion"),
    title: z.string().trim().min(1).max(300),
    merge: z.boolean(),
  }),
]);

// Drag one claim onto an article, a section, or a suggestion circle.
// An article or section is rewritten so the prose follows the claim list.
// A suggestion only regroups the pending recommendation or merge.
export async function moveGraphUnitToGroup(unitId: string, drop: PageDrop) {
  return toActionResult(async () => {
    const user = await requireUser();
    const actor = await currentActor();
    if (!actor.spaceId) throw new Error("Choose a space first.");
    const id = z.uuid().parse(unitId);
    const target = pageDropSchema.parse(drop);
    const client = getAdminSupabase();
    const unit = await client
      .from("units")
      .select("id,current_revision_id")
      .eq("id", id)
      .is("retired_at", null)
      .maybeSingle();
    if (unit.error) throw new Error(unit.error.message);
    if (!unit.data) throw new Error("This knowledge is no longer active.");
    if (target.kind === "suggestion") {
      await leaveArticles(client, id, null);
      await saveSuggestionPatches(
        client,
        suggestionMembership(
          await pendingGroups(client, actor.spaceId),
          id,
          unit.data.current_revision_id,
          target,
        ),
        user.id,
      );
      return {};
    }
    const destination = await destinationSection(
      client,
      actor.spaceId,
      target,
      id,
    );
    await leaveArticles(client, id, destination);
    await saveSuggestionPatches(
      client,
      releaseSuggestionUnit(await pendingGroups(client, actor.spaceId), id),
      user.id,
    );
    return {};
  });
}

async function pendingGroups(
  client: AdminSupabase,
  spaceId: string,
): Promise<SuggestionGroup[]> {
  const { data, error } = await client
    .from("article_suggestions")
    .select("id,title,kind,unit_ids,revision_ids,sections")
    .eq("space_id", spaceId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    unitIds: row.unit_ids,
    revisionIds: row.revision_ids,
    sections: suggestionSections(row.sections),
  }));
}

async function saveSuggestionPatches(
  client: AdminSupabase,
  patches: ReturnType<typeof releaseSuggestionUnit>,
  userId: string,
) {
  for (const patch of patches) {
    const update = {
      unit_ids: patch.unitIds,
      revision_ids: patch.revisionIds,
      sections: patch.sections as unknown as Json,
      ...(patch.dismiss
        ? {
            status: "dismissed" as const,
            note: "Moved to another group.",
            decided_at: new Date().toISOString(),
            decided_by: userId,
          }
        : {}),
    };
    const { data, error } = await client
      .from("article_suggestions")
      .update(update as never)
      .eq("id", patch.id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length)
      throw new Error("That suggestion changed. Try the move again.");
  }
}

type SectionRow = {
  id: string;
  title: string;
  position?: number;
  mode: string;
  query: Json | null;
};

function pinned(query: Json | null): PinnedQuery | null {
  if (!query || typeof query !== "object" || Array.isArray(query)) return null;
  return query as PinnedQuery;
}

function claimSection(row: SectionRow, cites: boolean): ClaimSection {
  return {
    id: row.id,
    title: row.title.trim() || "Untitled",
    mode: row.mode,
    query: pinned(row.query),
    cites,
  };
}

async function destinationSection(
  client: AdminSupabase,
  spaceId: string,
  target:
    | { kind: "article"; page: string }
    | { kind: "section"; page: string; section: string },
  unitId: string,
): Promise<ClaimSection> {
  const pages = await client
    .from("pages")
    .select("id,title")
    .is("retired_at", null)
    .eq("kind", "article")
    .filter("space_id", "eq", spaceId);
  if (pages.error) throw new Error(pages.error.message);
  const wanted = target.page.trim().toLowerCase();
  const found = (pages.data ?? []).filter(
    (page) => page.title.trim().toLowerCase() === wanted,
  );
  if (found.length !== 1)
    throw new Error("That article is no longer available.");
  const sections = await client
    .from("sections")
    .select("id,title,position,mode,query")
    .eq("page_id", found[0]!.id)
    .is("retired_at", null)
    .order("position");
  if (sections.error) throw new Error(sections.error.message);
  const rows = sections.data ?? [];
  const chosen =
    target.kind === "section"
      ? rows.find((row) => (row.title.trim() || "Untitled") === target.section)
      : rows.find(
          (row) => row.mode === "generated" && canPinClaim(pinned(row.query)),
        );
  if (!chosen)
    throw new Error(
      target.kind === "section"
        ? "That section is not on this article."
        : "This article has no section that can take one claim.",
    );
  const cited = await client
    .from("section_inputs")
    .select("unit_id")
    .eq("section_id", chosen.id)
    .eq("unit_id", unitId);
  if (cited.error) throw new Error(cited.error.message);
  return claimSection(chosen, (cited.data ?? []).length > 0);
}

async function citedUnitIds(
  client: AdminSupabase,
  unitId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("section_inputs")
    .select("section_id")
    .eq("unit_id", unitId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.section_id));
}

async function leaveArticles(
  client: AdminSupabase,
  unitId: string,
  destination: ClaimSection | null,
) {
  const cited = await citedUnitIds(client, unitId);
  const listed = await client
    .from("sections")
    .select("id,title,mode,query")
    .is("retired_at", null)
    .contains("query", { unitIds: [unitId] });
  if (listed.error) throw new Error(listed.error.message);
  const byId = new Map<string, SectionRow>();
  for (const row of listed.data ?? []) byId.set(row.id, row);
  const missing = [...cited].filter(
    (id) => !byId.has(id) && id !== destination?.id,
  );
  if (missing.length) {
    const extra = await client
      .from("sections")
      .select("id,title,mode,query")
      .in("id", missing)
      .is("retired_at", null);
    if (extra.error) throw new Error(extra.error.message);
    for (const row of extra.data ?? []) byId.set(row.id, row);
  }
  const holders = [...byId.values()]
    .filter((row) => row.id !== destination?.id)
    .map((row) => claimSection(row, cited.has(row.id)));
  const placed = placeClaimEdits(unitId, destination, holders);
  if ("error" in placed) throw new Error(placed.error);
  const deps = placed.refreshIds.length ? await getServerDeps() : null;
  if (deps?.writer.name === "fake")
    throw new Error(
      "Configure an AI provider in Settings before moving knowledge into an article.",
    );
  const db = deps?.db ?? supabaseRpc(client);
  if (destination) {
    const next =
      placed.edits.find((edit) => edit.id === destination.id)?.query ??
      destination.query ??
      {};
    const selected = await db.call<string[]>("living_page_query_units", {
      p_query: next,
    });
    if (!selected.includes(unitId))
      throw new Error(
        `"${destination.title}" does not include this knowledge.`,
      );
  }
  if (placed.edits.length) {
    const actions: DraftAction[] = placed.edits.map((edit) => ({
      type: "update_section_query",
      targetId: edit.id,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { query: edit.query as SectionQuery, fromQuery: edit.fromQuery },
    }));
    const where = destination ? destination.title : "a suggestion";
    const result = await commitPersonEdit(
      db,
      `Move knowledge into ${where}`,
      actions,
    );
    if (result.status !== "applied")
      throw new Error("Move was not applied. Check Changes for details.");
  }
  if (deps) {
    for (const sectionId of placed.refreshIds) {
      await refreshSectionStyle(
        db,
        deps.writer,
        sectionId,
        "A person moved one claim. State the claims this section now has, and stop stating claims it no longer has.",
      );
    }
  }
}
