import { expect, it } from "vitest";
import { compactFilingEvidence, compactPreviousPlacements, filedDestinations, sampleDestinationClaims } from "./filingEvidence";

it("sends shared evidence once while preserving full text, locations and every citation", () => {
  const passage = { text: "Full source evidence ".repeat(1000), location: { page: 17 } };
  const context = { neighbors: [{ content: "Read only context" }], sourceEvidence: [
    { ref: "C1", passages: [passage] }, { ref: "C2", passages: [passage, { ...passage, location: { page: 18 } }] },
  ] };
  const result = compactFilingEvidence(context) as typeof context & { sourcePassages: (typeof passage & { ref: string })[] };
  expect(result.sourcePassages).toEqual([{ ref: "P1", ...passage }, { ref: "P2", ...passage, location: { page: 18 } }]);
  expect(result.sourceEvidence).toEqual([
    { ref: "C1", passages: [{ passageRef: "P1" }] },
    { ref: "C2", passages: [{ passageRef: "P1" }, { passageRef: "P2" }] },
  ]);
  expect(result.neighbors).toEqual(context.neighbors);
  expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(context).length);
  expect(context.sourceEvidence[0]!.passages[0]).toBe(passage);
});

it("compresses repeated earlier domain paths without losing any claim memberships",()=>{
  const placements=Array.from({length:1843},(_,index)=>({ref:`C${index+1}`,domainPaths:[`Enneagram/Type descriptions/Type ${index%9}/Stress and unhealthy patterns`,`Enneagram/Typing and identifying type/Misidentifying type`]}));
  const compact=compactPreviousPlacements(placements);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify({previousPlacements:placements}).length/2);
  if(!("previousDomains" in compact))throw new Error("Expected compact paths");
  const paths=new Map(compact.previousDomains.map(domain=>[domain.ref,domain.path]));
  expect(compact.previousPlacements.map(placement=>({ref:placement.ref,domainPaths:placement.domainRefs.map(ref=>paths.get(ref))}))).toEqual(placements);
});

it("leaves absent and unrelated context intact", () => {
  expect(compactFilingEvidence(undefined)).toBeUndefined();
  const context = { neighbors: [] };
  expect(compactFilingEvidence(context)).toBe(context);
  const small = { sourceEvidence: [{ ref: "C1", passages: [{ location: null, text: "Short distinct source." }] }] };
  expect(compactFilingEvidence(small)).toBe(small);
});

it("summarizes earlier filing per destination with counts and the latest example titles",()=>{
  const placements=Array.from({length:500},(_,index)=>({title:`Claim ${index}`,domainPaths:index%2?["B/Child"]:["A","B/Child"]}));
  const summary=filedDestinations(placements);
  expect(summary).toEqual([{path:"A",claims:250,examples:["Claim 494","Claim 496","Claim 498"]},{path:"B/Child",claims:500,examples:["Claim 497","Claim 498","Claim 499"]}]);
  expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(placements).length/50);
});

it("samples at most a few recent earlier claims per current destination, keeping filing order",()=>{
  const claims=Array.from({length:20},(_,index)=>({ref:`C${index+1}`,domainPaths:[index<10?"A":"B"]}));
  expect(sampleDestinationClaims(claims,new Set(["A"]),3).map(c=>c.ref)).toEqual(["C8","C9","C10"]);
  expect(sampleDestinationClaims(claims,new Set(["A","B"]),2).map(c=>c.ref)).toEqual(["C9","C10","C19","C20"]);
  expect(sampleDestinationClaims(claims,new Set(["Other"]),2)).toEqual([]);
});
