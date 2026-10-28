import { NODE_KINDS } from "@/lib/graph";
import { describe, expect, it } from "vitest";
import { NODE_SCREENS } from "./nodeTypes";

describe("NODE_SCREENS", () => {
  it("has a preview for every node kind", () => {
    for (const kind of NODE_KINDS) {
      expect(NODE_SCREENS[kind], kind).toBeDefined();
    }
    expect(Object.keys(NODE_SCREENS).sort()).toEqual([...NODE_KINDS].sort());
  });
});
