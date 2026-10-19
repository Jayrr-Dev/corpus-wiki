import { expect, it } from "vitest";
import { uploadAssignmentEvidence, validateUploadGroups, validateUploadPlacements, type UploadTopicContext } from "./uploadAssignment";

export const context: UploadTopicContext = {
 sourceTitle:"ULA requirements.docx",sourceSections:[{position:0,location:{heading:"Permit thresholds"}}],domainPaths:["EPCOR","EPCOR/Requirements"],domainTabs:[],
 claims:[{unitId:"new",title:"Permit threshold",content:"A permit is required within 1m.",entities:["EPCOR"]},{unitId:"new2",title:"Safety responsibility",content:"The employer is responsible for safety.",entities:[]}],
 revisions:[{unitId:"new",revisionId:"r1"},{unitId:"new2",revisionId:"r2"},{unitId:"existing",revisionId:"r3"},{unitId:"unrelated",revisionId:"r4"}],
 evidence:[{unitId:"new",passages:[{location:{heading:"Permit thresholds"},text:"A permit is required within 1m."}]}],
 snapshot:{domains:[{id:"d1",name:"EPCOR",path:"EPCOR",parent_id:null,retired_at:null,context_entity_id:null},{id:"d2",name:"Requirements",path:"EPCOR/Requirements",parent_id:"d1",retired_at:null,context_entity_id:null}],
 claims:[{id:"new",revisionId:"r1",content:"A permit is required within 1m.",retiredAt:null},{id:"existing",revisionId:"r3",content:"Utility permits govern ground disturbance.",retiredAt:null},{id:"unrelated",revisionId:"r4",content:"Unrelated claim.",retiredAt:null}],unitDomains:[{unit_id:"existing",domain_id:"d2"},{unit_id:"unrelated",domain_id:"d1"}]},
 connections:[{from:"new",to:"existing",type:"related_to"}],vectors:[{revisionId:"r1",model:"m",embedding:"[1,0]"},{revisionId:"r3",model:"m",embedding:"[0.95,0.05]"},{revisionId:"r4",model:"m",embedding:"[0,1]"}],
};

it("retrieves domain examples using current embeddings and real connections without sending vectors or IDs",()=>{
 const result=uploadAssignmentEvidence(context);
 expect(result.candidates[0]!.neighbors).toEqual([expect.objectContaining({connected:true,similarity:expect.any(Number)})]);
 expect(result.domainProfiles[0]).toMatchObject({path:"EPCOR/Requirements",totalClaims:1});
 expect(result.links).toEqual([{from:"C1",to:"E1",type:"related_to"}]);
 expect(result.evidence[0]!.passages[0]!.location).toEqual({heading:"Permit thresholds"});
 expect(JSON.stringify(result.neighbors)).not.toContain('"existing"');
});
it("rejects incomplete and duplicate plans, missing assignments and out-of-scope invented domains",()=>{
 const claims=uploadAssignmentEvidence(context).claims;
 expect(()=>validateUploadGroups([{scopePath:"EPCOR",refs:["C1"]}],claims,context.domainPaths)).toThrow("omitted");
 expect(()=>validateUploadGroups([{scopePath:"EPCOR",refs:["C1","C1","C2"]}],claims,context.domainPaths)).toThrow("repeated");
 expect(()=>validateUploadGroups([{scopePath:"Unknown/Child",refs:["C1","C2"]}],claims,context.domainPaths)).toThrow("existing");
 const input={sourceTitle:context.sourceTitle,claims,existingPaths:context.domainPaths,scopePath:"EPCOR"};
 expect(()=>validateUploadPlacements(new Map([["new",["EPCOR/Requirements"]]]),input)).toThrow("no domain");
 expect(()=>validateUploadPlacements(new Map([["new",["Elsewhere"]],["new2",["EPCOR"]]]),input)).toThrow("primary");
 expect(()=>validateUploadPlacements(new Map([["new",["EPCOR/Requirements","Unknown/Child"]],["new2",["EPCOR"]]]),input)).toThrow("Secondary");
});
