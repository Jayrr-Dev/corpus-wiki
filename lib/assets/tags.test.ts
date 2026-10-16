import { describe, expect, it } from "vitest";
import { isTypeWord, normalizeTag, TagVocabulary, tagKey } from "./tags";

describe("normalizeTag", () => {
  it("lowercases and tidies spelling", () => {
    expect(normalizeTag("  #Site_Plan. ")).toBe("site plan");
    expect(normalizeTag("“The Bridge”")).toBe("bridge");
    expect(normalizeTag("C++")).toBe("c++");
  });
});

describe("tagKey", () => {
  it("folds plurals, hyphens and spaces", () => {
    expect(tagKey("Blue-prints")).toBe(tagKey("blueprint"));
    expect(tagKey("batteries")).toBe(tagKey("battery"));
    expect(tagKey("boxes")).toBe(tagKey("box"));
    expect(tagKey("news")).not.toBe(tagKey("new"));
    expect(tagKey("analysis")).toBe("analysis");
  });
});

describe("TagVocabulary", () => {
  it("folds a new tag into the known spelling", () => {
    const vocabulary = new TagVocabulary(["blueprint", "site plan", "construction"]);
    expect(vocabulary.clean(["Blueprints", "site-plans", "constructon", "Photo", "solar panels"])).toEqual(["blueprint", "site plan", "construction", "solar panels"]);
    // Learned within the pass
    expect(vocabulary.canonical("solar panel")).toBe("solar panels");
  });

  it("follows renamed tags", () => {
    const vocabulary = new TagVocabulary(["engineers"], [{ alias: "engineer team", tag: "engineers" }]);
    expect(vocabulary.canonical("engineer teams")).toBe("engineers");
  });

  it("does not merge short words one letter apart", () => {
    const vocabulary = new TagVocabulary(["cat"]);
    expect(vocabulary.canonical("car")).toBe("car");
  });
});

describe("isTypeWord", () => {
  it("knows kind-of-media words", () => {
    expect(isTypeWord("Photographs")).toBe(true);
    expect(isTypeWord("screen shots")).toBe(true);
    expect(isTypeWord("bridge")).toBe(false);
  });
});
