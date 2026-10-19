import type { Composition } from "./compose";
export type ComposerSnapshot = { title: string; slug: string; paragraphs: { id: string; revisionId: string; text: string; section: string; hasMedia: boolean }[] };
export type FigureSection = { sourceIndex?: number; sectionId?: string | null; sectionTitle?: string; sectionPosition?: number; originalSectionId?: string; originalSectionTitle?: string; originalSectionPosition?: number };
export type ComposerRun = { omittedFigureCount?: number; id: string; page_id: string; composition: Omit<Composition, "figures"> & { figures: (Composition["figures"][number] & FigureSection)[] }; snapshot: ComposerSnapshot; review: unknown; model: string; created_at: string };
export type ShownIllustration = FigureSection & { evidenceRevisions?: Record<string, string>; id: string; pageId: string; after: string; caption: string; alt: string; src: string; learningGoal: string; evidence: string[]; assetType?: string; assetId?: string };
