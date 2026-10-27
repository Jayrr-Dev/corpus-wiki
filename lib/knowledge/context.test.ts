import { describe, expect, it } from "vitest";
import { contextsCompatibleForMerge, normalizeKnowledgeContext, parseKnowledgeContext, type KnowledgeContext } from "./context";
const known: KnowledgeContext = {entities:[{type:"person",key:"alex-1",role:"subject"}],applicability:{status:"scoped",entities:[{type:"company",key:"acme"}],conditions:null}};
describe("knowledge context compatibility",()=>{
 it("never treats absent or unspecified scope as universal",()=>{
  expect(contextsCompatibleForMerge(null,null)).toBe(false);
  const unspecified:KnowledgeContext={...known,applicability:{status:"unspecified",entities:[],conditions:null}};
  expect(contextsCompatibleForMerge(unspecified,unspecified)).toBe(false);
 });
 it("uses stable identity and roles, ignoring mentions and array ordering",()=>{
  expect(contextsCompatibleForMerge(known,{...known,entities:[{type:"company",key:"vendor",role:"mentioned"},...known.entities]})).toBe(true);
  expect(contextsCompatibleForMerge(known,{...known,entities:[{type:"person",key:"alex-2",role:"subject"}]})).toBe(false);
  expect(contextsCompatibleForMerge(known,{...known,entities:[{...known.entities[0]!,role:"object"}]})).toBe(false);
 });
 it("rejects malformed and contradictory scope",()=>{
  expect(parseKnowledgeContext({entities:[]})).toBeNull();
  expect(parseKnowledgeContext({...known,entities:[...known.entities,{...known.entities[0],role:"mentioned"}]})).toBeNull();
  expect(parseKnowledgeContext({...known,applicability:{...known.applicability,status:"general"}})).toBeNull();
  expect(parseKnowledgeContext({...known,applicability:{status:"scoped",entities:[],conditions:null}})).toBeNull();
 });
 it("keeps structure labels sorted and deduped, and ignores them when merging",()=>{
  const leads={from:{type:"person",key:"alex-1"},link:"leads" as const,to:{type:"team",key:"billing"},title:"Head of Billing",seniority:"director" as const,share:null,current:true};
  const partOf={from:{type:"team",key:"billing"},link:"part_of" as const,to:{type:"company",key:"acme"},title:"",seniority:null,share:null,current:true};
  const labelled={...known,structure:[partOf,leads,leads]};
  expect(normalizeKnowledgeContext(labelled).structure).toEqual([leads,{...partOf,title:null}]);
  expect(normalizeKnowledgeContext(known)).not.toHaveProperty("structure");
  expect(normalizeKnowledgeContext({...known,structure:[]})).not.toHaveProperty("structure");
  expect(contextsCompatibleForMerge(known,labelled)).toBe(true);
  expect(parseKnowledgeContext({...known,structure:[{...leads,link:"friends_with"}]})).toBeNull();
  expect(parseKnowledgeContext({...known,structure:[{...leads,share:1.5}]})).toBeNull();
 });
});
