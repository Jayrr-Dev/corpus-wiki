import type { SectionWriter } from "./index";

// Class methods live on the prototype. Object spread copies only own fields,
// so `{ ...writer }` drops reviseSection and the next call throws
// "reviseSection is not a function". Call through the original writer instead.
export function forwardSectionWriter(writer: SectionWriter, patch: Partial<SectionWriter> = {}): SectionWriter {
  const reviseSection = patch.reviseSection ?? writer.reviseSection?.bind(writer);
  if (typeof reviseSection !== "function") throw new Error("The article writer could not start. Retry this suggestion.");
  const prepareSection = patch.prepareSection ?? writer.prepareSection?.bind(writer);
  const reviewSections = patch.reviewSections ?? writer.reviewSections?.bind(writer);
  return {
    name: patch.name ?? writer.name,
    promptVersion: patch.promptVersion ?? writer.promptVersion,
    reviseSection,
    ...(prepareSection ? { prepareSection } : {}),
    ...(reviewSections ? { reviewSections } : {}),
    progress: "progress" in patch ? patch.progress : writer.progress,
  };
}
