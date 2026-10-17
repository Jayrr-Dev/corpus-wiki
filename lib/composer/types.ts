import type { Composition } from "./compose";
export type ComposerSnapshot = { title: string; slug: string; paragraphs: { id: string; revisionId: string; text: string; section: string; hasMedia: boolean }[] };
export type ComposerRun = { id: string; page_id: string; composition: Composition; snapshot: ComposerSnapshot; review: unknown; model: string; created_at: string };
export type ShownIllustration = { id: string; pageId: string; after: string; caption: string; alt: string; src: string; learningGoal: string; evidence: string[]; assetType?: string; assetId?: string };
