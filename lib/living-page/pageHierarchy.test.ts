import { describe, expect, it } from "vitest";
import { buildPageTree, pageAncestors } from "./pageHierarchy";
const page = (id: string, parent: string | null = null) => ({ id, title:id, slug:id, parent_page_id:parent });
describe("context page hierarchy", () => {
  it("keeps general articles at root and nests context topics", () => {
    const pages=[page("Company"),page("Safety","Company"),page("PPE","Safety"),page("General")];
    const tree=buildPageTree(pages);
    expect(tree.map(p=>p.id)).toEqual(["Company","General"]);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe("PPE");
    expect(pageAncestors(pages,pages[2]!).map(p=>p.id)).toEqual(["Company","Safety"]);
  });
  it("does not hide or recurse forever on missing parents or cycles", () => {
    expect(buildPageTree([page("a","b"),page("b","a"),page("c","missing")])).toHaveLength(3);
    expect(pageAncestors([page("a","b"),page("b","a")],page("a","b")).map(p=>p.id)).toEqual(["b"]);
  });
});
