import type { LucideIcon } from "lucide-react";
import {
  BookA, BookOpenText, Binary, ClipboardList, CopyCheck, Eraser, FileCheck, FolderTree, Fingerprint, Globe,
  IdCard, ImagePlay, Link2, ListTree, MapPin, Network, PenLine, Scale, ScanText, ShieldCheck, Telescope,
} from "lucide-react";

// ROLE ICONS: one icon per AI role, shared by the Roles tab and the AI flow canvas. A role keeps
// its icon wherever it appears. Keyed by the role ids in lib/ai/roles.ts.
export const ROLE_ICONS: Record<string, LucideIcon> = {
  extract_knowledge: ScanText, identify_entities: Fingerprint, link_knowledge: Link2, organize_topics: FolderTree,
  define_concepts: BookOpenText, plan_articles: ClipboardList, write_articles: PenLine,
  researcher: Telescope, reviewer: ShieldCheck, article_reviewer: FileCheck, domain_steward: Network,
  reconciler: Scale, deduplicator: CopyCheck, media_analyst: ImagePlay, dictionary_editor: BookA,
};

// AI steps without a role name and app steps on the canvas, keyed by canvas node id
export const STEP_ICONS: Record<string, LucideIcon> = {
  tidy: Eraser, place: MapPin, profiles: IdCard, embeddings: Binary, hierarchy: ListTree, "web-search": Globe,
};
