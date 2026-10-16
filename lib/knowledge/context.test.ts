import { describe, expect, it } from "vitest";
import { contextsCompatibleForMerge, parseKnowledgeContext, type KnowledgeContext } from "./context";
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
});
