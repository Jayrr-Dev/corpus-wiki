import { expect, it } from "vitest";
import { organizationEvidence, partitionSilhouette, simulateOrganization, subjectLinkWeight, validateAlternativeCoverage, validateCritique, residualParentEvidence, validateParentGroups } from "./organizationEvidence";
import type { DecisionSnapshot } from "./decider";

function fixture() {
  const claims=Array.from({length:6},(_,i)=>({id:`c${i}`,revisionId:`r${i}`,content:`${i<3 ? "Submission" : "Approval"} requirement ${i}`,retiredAt:null}));
  const snapshot:DecisionSnapshot={domains:[{id:"d",path:"Org/Process",name:"Process",parent_id:null,retired_at:null,context_entity_id:null}],claims,unitDomains:claims.map(c=>({unit_id:c.id,domain_id:"d"}))};
  const vectors=new Map(claims.map((c,i)=>[c.revisionId,i<3 ? [1,0.01*i] : [0.01*i,1]]));
  return {snapshot,vectors};
}
it("finds two subjects despite a sequence bridge, independent of claim order",()=>{
  const {snapshot,vectors}=fixture();
  const links=[{from:"c2",to:"c3",type:"precedes"}];
  const evidence=organizationEvidence(snapshot,vectors,links,["Org/Process"]);
  const two=evidence[0]!.alternatives.find(a=>a.groupCount===2)!;
  expect(two.groups.map(g=>g.claims)).toEqual([["C1","C2","C3"],["C4","C5","C6"]]);
  expect(two.semanticSilhouette).toBeGreaterThan(.9);
  const reversed={...snapshot,claims:[...snapshot.claims].reverse()};
  const reordered=organizationEvidence(reversed,vectors,links,["Org/Process"])[0]!.alternatives.find(a=>a.groupCount===2)!;
  const ids=(refs:string[],claims:typeof snapshot.claims)=>refs.map(ref=>claims[Number(ref.slice(1))-1]!.id).sort();
  expect(reordered.groups.map(g=>ids(g.claims,reversed.claims))).toEqual(two.groups.map(g=>ids(g.claims,snapshot.claims)));
  expect(subjectLinkWeight("precedes")).toBe(0);
  expect(subjectLinkWeight("supports")).toBeGreaterThan(0);
});

it("audits after-state parent leftovers and rejects a pass hiding a specific subject",()=>{
  const {snapshot,vectors}=fixture();
  const plan={candidateDecisions:[],assessments:[],confident:true,reason:"File approvals",operations:[
    {operation:"create" as const,sourcePath:null,destinationPath:"Org/Process",name:"Approval",claimIds:[]},
    {operation:"assign" as const,sourcePath:"Org/Process",destinationPath:"Org/Process/Approval",name:null,claimIds:["C4","C5","C6"]},
  ]};
  const parents=residualParentEvidence(snapshot,vectors,[],simulateOrganization(snapshot,plan,["Org/Process"]));
  expect(parents[0]!.claims.map(c=>c.ref)).toEqual(["C1","C2","C3"]);
  const critique={verdict:"improved" as const,grouping:"pass" as const,placement:"pass" as const,simplicity:"pass" as const,reason:"Smaller parent",findings:[],assessments:[],parentGroups:[]};
  expect(()=>validateParentGroups(critique,parents)).toThrow("every residual parent");
  const group={subject:"Submission requirements",claims:["C1","C2","C3"],kind:"specific_subject" as const,action:"keep" as const,reason:"All concern the process"};
  expect(()=>validateParentGroups({...critique,parentGroups:[{path:"Org/Process",groups:[group]}]},parents)).toThrow("Missed parent subject");
  expect(()=>validateParentGroups({...critique,parentGroups:[{path:"Org/Process",groups:[{...group,claims:["C1","C1","C2"]}]}]},parents)).toThrow("exactly once");
  expect(()=>validateParentGroups({...critique,parentGroups:[{path:"Org/Process",groups:[{...group,kind:"overview"}]}]},parents)).not.toThrow();
  expect(()=>validateParentGroups({...critique,parentGroups:[{path:"Org/Process",groups:[{...group,kind:"parent_subject"}]}]},parents)).not.toThrow();
});
it("does not use existing domain names as semantic evidence",()=>{
  const {snapshot,vectors}=fixture();
  const before=organizationEvidence(snapshot,vectors,[],["Org/Process"])[0]!;
  snapshot.domains[0]!.path="Different/Name";
  const after=organizationEvidence(snapshot,vectors,[],["Different/Name"])[0]!;
  expect(after.alternatives).toEqual(before.alternatives);
});
it("simulates sequential renames, moves and cross-filing without mutating the snapshot",()=>{
  const {snapshot}=fixture();
  const initial=JSON.stringify(snapshot);
  const plan={candidateDecisions:[],assessments:[],confident:true,reason:"Group",operations:[
    {operation:"create" as const,sourcePath:null,destinationPath:"Org/Process",name:"Submission",claimIds:[]},
    {operation:"assign" as const,sourcePath:"Org/Process",destinationPath:"Org/Process/Submission",name:null,claimIds:["C1","C2","C3"]},
    {operation:"rename" as const,sourcePath:"Org/Process/Submission",destinationPath:null,name:"Applications",claimIds:[]},
    {operation:"cross_file" as const,sourcePath:"Org/Process",destinationPath:"Org/Process/Applications",name:null,claimIds:["C4"]},
  ]};
  const simulated=simulateOrganization(snapshot,plan,["Org/Process"]);
  expect(simulated.before[0]!.count).toBe(6);
  expect(simulated.after.find(d=>d.path==="Org/Process")!.claims).toEqual(["C4","C5","C6"]);
  expect(simulated.after.find(d=>d.path.endsWith("Applications"))!.claims).toEqual(["C1","C2","C3","C4"]);
  expect(JSON.stringify(snapshot)).toBe(initial);
});
it("rejects skipped alternatives and favorable verdicts containing unresolved findings",()=>{
  const {snapshot,vectors}=fixture();
  const evidence=organizationEvidence(snapshot,vectors,[],["Org/Process"]);
  expect(()=>validateAlternativeCoverage({candidateDecisions:[],assessments:[],confident:true,reason:"Keep",operations:[],alternatives:[],scopes:[]},evidence)).toThrow("every supplied");
  const critique={verdict:"improved" as const,grouping:"pass" as const,placement:"pass" as const,simplicity:"pass" as const,reason:"Better",findings:[],assessments:[],parentGroups:[]};
  expect(()=>validateCritique(critique,1)).not.toThrow();
  expect(()=>validateCritique(critique,0)).toThrow("does not match");
  expect(()=>validateCritique(critique,1,["Org/Process"])).toThrow("every resulting domain");
  expect(()=>validateCritique({...critique,assessments:[{path:"Org/Process",labelFits:false,grouping:"pass",placement:"pass",reason:"Incorrect subject name"}]},1)).toThrow("still need revision");
  expect(()=>validateCritique({...critique,findings:[{path:"Org",claimIds:["C1"],issue:"Wrong subject",suggestion:"Move"}]},1)).toThrow("needs revision");
  expect(partitionSilhouette([[0,1]],[[1,.8],[.8,1]])).toBeNull();
});
