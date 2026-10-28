import { describe, expect, it } from "vitest";
import { GROUPING_IDS, GROUPING_LIST, GROUPINGS } from "./groupings";
import { NODE_KINDS, NODE_TYPE_LIST, NODE_TYPES } from "./nodeTypes";

describe("node type and grouping registries", () => {
  it("lists every node kind once, under its own key", () => {
    expect(NODE_TYPE_LIST.map((rule) => rule.kind).sort()).toEqual(
      [...NODE_KINDS].sort(),
    );
    for (const kind of NODE_KINDS) expect(NODE_TYPES[kind].kind).toBe(kind);
  });

  it("lists every grouping once, under its own key", () => {
    expect(GROUPING_LIST.map((rule) => rule.id)).toEqual([...GROUPING_IDS]);
    for (const id of GROUPING_IDS) expect(GROUPINGS[id].id).toBe(id);
  });

  it("builds each grouping around a hub kind", () => {
    for (const grouping of GROUPING_LIST)
      expect(NODE_TYPES[grouping.hubKind].role).toBe("hub");
  });

  it("only centers a node in a grouping built around its own kind", () => {
    for (const rule of NODE_TYPE_LIST) {
      if (!rule.centers) continue;
      expect(GROUPINGS[rule.centers].hubKind).toBe(rule.kind);
    }
  });
});
