import type { ListOptions } from "./fetchers";
import { useTableList, useTableRow } from "./useTable";

// =====================================================================
// TYPED READ HOOKS, ONE PAIR PER TABLE (list + by id). Reads only:
// writes go through server code and Change control, never these hooks.
// Lists default to newest first where the table has created_at.
// =====================================================================

export { fetchRowById, fetchRows } from "./fetchers";
export type { IdTableName, ListOptions, Row, TableName } from "./fetchers";
export { queryKeys } from "./keys";
export { useTableList, useTableRow } from "./useTable";
export { fetchSectionLines, type ShownLine, useSectionLines } from "./sectionLines";

// INGESTION
export const useSources = (o: ListOptions<"sources"> = {}) =>
  useTableList("sources", { orderBy: "source_date", ascending: false, ...o });
export const useSource = (id?: string) => useTableRow("sources", id);
export const usePassages = (o: ListOptions<"passages"> = {}) =>
  useTableList("passages", { orderBy: "position", ...o });
export const usePassage = (id?: string) => useTableRow("passages", id);
export const useShiftEvents = (o: ListOptions<"shift_events"> = {}) =>
  useTableList("shift_events", { orderBy: "created_at", ascending: false, ...o });
export const useShiftEvent = (id?: string) => useTableRow("shift_events", id);

// KNOWLEDGE STORE
export const useDomains = (o: ListOptions<"domains"> = {}) =>
  useTableList("domains", { orderBy: "path", ...o });
export const useDomain = (id?: string) => useTableRow("domains", id);
export const useEntities = (o: ListOptions<"entities"> = {}) =>
  useTableList("entities", { orderBy: "name", ...o });
export const useEntity = (id?: string) => useTableRow("entities", id);
export const useUnits = (o: ListOptions<"units"> = {}) =>
  useTableList("units", { orderBy: "last_changed_at", ascending: false, ...o });
export const useUnit = (id?: string) => useTableRow("units", id);
export const useRevisions = (o: ListOptions<"revisions"> = {}) =>
  useTableList("revisions", { orderBy: "created_at", ascending: false, ...o });
export const useRevision = (id?: string) => useTableRow("revisions", id);
export const useUnitEntities = (o: ListOptions<"unit_entities"> = {}) => useTableList("unit_entities", o);
export const useUnitDomains = (o: ListOptions<"unit_domains"> = {}) => useTableList("unit_domains", o);
export const useRelationships = (o: ListOptions<"relationships"> = {}) =>
  useTableList("relationships", { orderBy: "created_at", ascending: false, ...o });
export const useRelationship = (id?: string) => useTableRow("relationships", id);

// CHANGE CONTROL
export const useChangeSets = (o: ListOptions<"change_sets"> = {}) =>
  useTableList("change_sets", { orderBy: "created_at", ascending: false, ...o });
export const useChangeSet = (id?: string) => useTableRow("change_sets", id);
export const useActions = (o: ListOptions<"actions"> = {}) =>
  useTableList("actions", { orderBy: "position", ...o });
export const useAction = (id?: string) => useTableRow("actions", id);
export const useExceptions = (o: ListOptions<"exceptions"> = {}) =>
  useTableList("exceptions", { orderBy: "created_at", ascending: false, ...o });
export const useException = (id?: string) => useTableRow("exceptions", id);

// LIVING PAGE (removed pages and sections are retired, so lists show only shown ones)
export const usePages = (o: ListOptions<"pages"> = {}) =>
  useTableList("pages", { orderBy: "title", ...o, filters: { retired_at: null, ...o.filters } });
export const usePage = (id?: string) => useTableRow("pages", id);
export const useSections = (o: ListOptions<"sections"> = {}) =>
  useTableList("sections", { orderBy: "position", ...o, filters: { retired_at: null, ...o.filters } });
export const useSection = (id?: string) => useTableRow("sections", id);
export const useSectionInputs = (o: ListOptions<"section_inputs"> = {}) => useTableList("section_inputs", o);
export const useChangeNotes = (o: ListOptions<"change_notes"> = {}) =>
  useTableList("change_notes", { orderBy: "created_at", ascending: false, ...o });
export const useChangeNote = (id?: string) => useTableRow("change_notes", id);
export const useLine = (id?: string) => useTableRow("lines", id);
export const useLineRevisions = (o: ListOptions<"line_revisions"> = {}) =>
  useTableList("line_revisions", { orderBy: "created_at", ascending: false, ...o });

// AI USAGE: one row per AI call (token log on /settings), newest first
export const useAiCalls = (o: ListOptions<"ai_calls"> = {}) =>
  useTableList("ai_calls", { orderBy: "created_at", ascending: false, limit: 1000, ...o });
