import { z } from "zod";

export const domainReviewSchema = z.object({
  operation: z.enum(["none", "rename", "merge", "inspect"]),
  domainId: z.uuid().nullable(), destinationId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120).nullable(),
  confident: z.boolean(), reason: z.string().trim().min(1).max(2000),
});
export type DomainReview = z.infer<typeof domainReviewSchema>;
export type DomainReviewSnapshot = {
  domains: { id: string; name: string; path: string; parent_id: string | null; retired_at: string | null; context_entity_id: string | null }[];
};

export function validateDomainReview(review: DomainReview, snapshot: DomainReviewSnapshot) {
  if (review.operation === "none") return;
  const domain = snapshot.domains.find((d) => d.id === review.domainId && !d.retired_at);
  if (!domain) throw new Error("The reviewed domain is no longer available.");
  if (review.operation === "rename" && (!review.name || review.name.includes("/") || review.name === domain.name)) throw new Error("A rename needs a different name without slashes.");
  if (review.operation === "merge") {
    const destination = snapshot.domains.find((d) => d.id === review.destinationId && !d.retired_at);
    if (!destination || destination.id === domain.id || !domain.parent_id || domain.parent_id !== destination.parent_id || domain.context_entity_id !== destination.context_entity_id || snapshot.domains.some((d) => d.parent_id === domain.id)) {
      throw new Error("Only equivalent leaf domains with the same parent and context can be consolidated. Broader changes need a Structure exception.");
    }
  }
}
