import { describe, expect, it } from "vitest";
import { validateDomainReview, type DomainReview, type DomainReviewSnapshot } from "./review";
const domain = (id: string, parent_id: string | null) => ({ id, parent_id, name: id, path: id, retired_at: null, context_entity_id: null });
const snapshot: DomainReviewSnapshot = { domains: [domain("root", null), domain("a", "root"), domain("b", "root"), domain("other", null)] };
const merge: DomainReview = { operation: "merge", domainId: "a", destinationId: "b", name: null, confident: true, reason: "Same topic and content" };
describe("domain steward safeguards", () => {
  it("allows sibling leaf consolidation", () => expect(() => validateDomainReview(merge, snapshot)).not.toThrow());
  it("prevents crossing organization or reference roots", () => expect(() => validateDomainReview({ ...merge, destinationId: "other" }, snapshot)).toThrow(/same parent/));
  it("does not retire a subtree while merging a leaf", () => expect(() => validateDomainReview(merge, { domains: [...snapshot.domains, domain("child", "a")] })).toThrow(/leaf/));
  it("prevents fabricated targets", () => expect(() => validateDomainReview({ ...merge, domainId: "unknown" }, snapshot)).toThrow(/available/));
  it("prevents a rename from smuggling in a new hierarchy", () => expect(() => validateDomainReview({ ...merge, operation: "rename", name: "x/y" }, snapshot)).toThrow(/slashes/));
});
