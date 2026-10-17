import { expect, it } from "vitest";
import { domainReviewKey, focusedReview, validateFocusedReview } from "./focusedReview";
import type { DecisionSnapshot } from "./decider";

function fixture() {
  const domains = ["Company/Large", "Company/Small", "Other/Private"].map((path,i) => ({ id: `d${i}`, path, name: path.split("/")[1]!, parent_id: null, retired_at: null, context_entity_id: null }));
  const claims = domains.flatMap((d,i) => Array.from({length: i === 0 ? 20 : 12}, (_,j) => ({ id: `${d.id}c${j}`, revisionId: `${d.id}r${j}`, content: `${d.path} requirement number ${j}`, retiredAt: null })));
  const snapshot: DecisionSnapshot = { domains, claims, unitDomains: claims.map(c => ({unit_id:c.id, domain_id:c.id.slice(0,2)})) };
  return { snapshot, vectors: new Map(claims.map(c => [c.revisionId, c.id.startsWith("d2") ? [0,1] : [1,0]])) };
}
it("reviews the largest group first, excludes unrelated roots and advances past reviewed domains", () => {
  const {snapshot,vectors} = fixture();
  const scope = focusedReview(snapshot,vectors,[],[])!;
  expect(scope.target.path).toBe("Company/Large");
  expect(scope.context.mustReview).toEqual(["Company/Large"]);
  expect(JSON.stringify(scope.context)).not.toContain("Other/Private");
  expect(scope.context.clusters.flatMap(c => c.claims).map(c => c.ref)).toContain("C1");
  expect(focusedReview(snapshot,vectors,[],["Company/Large"])!.target.path).not.toBe("Company/Large");
  expect(focusedReview(snapshot,vectors,[],snapshot.domains.map(d => d.path))).toBeNull();
});
it("uses neighbors as destination context while blocking edits to their claims", () => {
  const {snapshot,vectors} = fixture();
  const scope = focusedReview(snapshot,vectors,[{from:"d0c0",to:"d1c0",type:"supports"}],[])!;
  expect(scope.destinations.has("Company/Small")).toBe(true);
  const review = {assessments:[],candidateDecisions:[],reason:"Organize",confident:true,operations:[{operation:"assign" as const,sourcePath:"Company/Large",destinationPath:"Company/Small",name:null,claimIds:["C1"]}]};
  expect(() => validateFocusedReview(review,scope)).not.toThrow();
  expect(() => validateFocusedReview({...review,operations:[{...review.operations[0]!,claimIds:["C21"]}]},scope)).toThrow("context only");
  expect(() => validateFocusedReview({...review,operations:[{...review.operations[0]!,sourcePath:"Company/Small"}]},scope)).toThrow("selected domain");
});

it("requires inspection of existing children and rejects competing process branches", () => {
  const {snapshot,vectors} = fixture();
  snapshot.domains.push({id:"child",path:"Company/Large/Old Application Process",name:"Old Application Process",parent_id:"d0",retired_at:null,context_entity_id:null});
  const scope = focusedReview(snapshot,vectors,[],[])!;
  expect(scope.context.mustReview).toContain("Company/Large/Old Application Process");
  const review = {assessments:[],candidateDecisions:[],reason:"Organize",confident:true,operations:[{operation:"create" as const,sourcePath:null,destinationPath:"Company/Large",name:"Procedure Steps",claimIds:[]}]};
  expect(() => validateFocusedReview(review,scope)).toThrow("process child already exists");
});

it("does not skip a two-claim residual parent pocket", () => {
  const {snapshot,vectors}=fixture();
  snapshot.claims=snapshot.claims.slice(0,2);
  snapshot.unitDomains=snapshot.unitDomains.slice(0,2);
  snapshot.domains.push({id:"child",path:"Company/Large/Filed",name:"Filed",parent_id:"d0",retired_at:null,context_entity_id:null});
  expect(focusedReview(snapshot,vectors,[],[])?.target.path).toBe("Company/Large");
});

it("re-ranks fresh memberships after a domain is subdivided", () => {
  const {snapshot,vectors} = fixture();
  snapshot.domains.push({id:"child",path:"Company/Large/Filed",name:"Filed",parent_id:"d0",retired_at:null,context_entity_id:null});
  for (const row of snapshot.unitDomains) if (row.domain_id === "d0" && row.unit_id !== "d0c0") row.domain_id = "child";
  expect(focusedReview(snapshot,vectors,[],[])!.target.path).not.toBe("Company/Large");
});

it("skips unchanged evidence but reopens a changed domain for a bounded follow-up", () => {
  const {snapshot,vectors} = fixture();
  const key = domainReviewKey(snapshot,[],"Company/Large");
  expect(focusedReview(snapshot,vectors,[],[key])!.target.path).not.toBe("Company/Large");
  snapshot.claims[0]!.revisionId = "changed";
  vectors.set("changed",[1,0]);
  expect(focusedReview(snapshot,vectors,[],[key])!.target.path).toBe("Company/Large");
  expect(focusedReview(snapshot,vectors,[],["Company/Large|1","Company/Large|2","Company/Large|3"])!.target.path).not.toBe("Company/Large");
});

it("confines explicit domain reviews and their destinations to the selected subtree", () => {
  const {snapshot,vectors}=fixture();
  const scope=focusedReview(snapshot,vectors,[{from:"d0c0",to:"d1c0",type:"supports"}],[],"Company/Large")!;
  expect(scope.destinations.has("Company/Small")).toBe(false);
  const review={assessments:[],candidateDecisions:[],reason:"Move",confident:true,operations:[{operation:"assign" as const,sourcePath:"Company/Large",destinationPath:"Company/Small",name:null,claimIds:["C1"]}]};
  expect(()=>validateFocusedReview(review,scope)).toThrow("outside the reviewed neighborhood");
  expect(()=>validateFocusedReview({...review,operations:[{operation:"create",sourcePath:null,destinationPath:"Company/Large",name:"Requirements",claimIds:[]},{...review.operations[0]!,destinationPath:"Company/Large/Requirements"}]},scope)).not.toThrow();
});
