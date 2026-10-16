import { afterEach, describe, expect, it, vi } from "vitest";
import { assignedSkill,skillInstructions,skillTrace } from "./prompt";
import { defaultSkill } from "./defaults";
import { resolveStageSkills,skillInputSchema } from "./server";
import { TokenFactorySectionWriter } from "@/lib/living-page/writers/tokenFactory";
import { TokenFactoryReconciliationClient } from "@/lib/ai/tokenFactory/client";
import { planArticle } from "@/lib/living-page/articlePlanner";
import type { AssignedSkill,StageSkills } from "./types";

const custom:AssignedSkill={id:"10000000-0000-4000-8000-000000000001",name:"Custom voice",instructions:"CUSTOM_STYLE_327: explain each requirement in plain language.",version:3};
afterEach(()=>vi.unstubAllGlobals());
describe("stage skill selection",()=>{
  it("uses defaults only when unconfigured, and honors explicit app-rules-only",()=>{
    expect(assignedSkill("write_articles")?.id).toBe(defaultSkill("write_articles").id);
    expect(assignedSkill("write_articles",{write_articles:null})).toBeNull();
    expect(skillInstructions(["write_articles"],{write_articles:null})).toBe("");
    expect(assignedSkill("plan_articles",{write_articles:custom})?.id).toBe(defaultSkill("plan_articles").id);
  });
  it("records the selected skill identity and exact version",()=>{
    expect(skillTrace("writer",["write_articles"],{write_articles:custom})).toContain(`${custom.id}@3`);
    expect(skillTrace("writer",["write_articles"],{write_articles:null})).toContain("write_articles=none");
  });
  it("resolves saved assignments and rejects unavailable archived skills",()=>{
    const skill={...custom,description:"",builtin_key:null,archived_at:null,updated_at:""};
    expect(resolveStageSkills({skills:[skill],assignments:[{stage:"write_articles",skill_id:custom.id}]}).write_articles?.version).toBe(3);
    expect(()=>resolveStageSkills({skills:[{...skill,archived_at:"2026-10-14"}],assignments:[{stage:"write_articles",skill_id:custom.id}]})).toThrow("unavailable");
  });
  it("validates content bounds and requires a version for updates",()=>{
    const value={id:null,expectedVersion:null,name:" Example ",description:"",instructions:"Use simple prose."};
    expect(skillInputSchema.parse(value).name).toBe("Example");
    expect(skillInputSchema.safeParse({...value,id:custom.id}).success).toBe(false);
    expect(skillInputSchema.safeParse({...value,instructions:"x".repeat(20001)}).success).toBe(false);
  });
});

function intercept(answer:object) {
  // The writer's line fact-check gets an empty verdict list, which keeps every line
  const fetch=vi.fn(async(_url:unknown,init:RequestInit)=>{
    const checking=JSON.parse(String(init.body)).response_format?.json_schema?.name==="line_fact_check";
    return new Response(JSON.stringify({model:"test",choices:[{finish_reason:"stop",message:{content:JSON.stringify(checking?{lines:[]}:answer)}}]}));
  });
  vi.stubGlobal("fetch",fetch);
  return ()=>JSON.parse(String((fetch.mock.calls[0] as unknown as [unknown,RequestInit])[1].body));
}
describe("assigned skills reach actual AI requests",()=>{
  it("uses role overrides and restores the assigned skill when cleared", () => {
    const library = { skills: [], assignments: [] };
    expect(resolveStageSkills({ ...library, roleInstructions: [{ role: "plan_articles", instructions: "Custom planner", version: 2 }] }).plan_articles?.instructions).toBe("Custom planner");
    expect(resolveStageSkills({ ...library, roleInstructions: [] }).plan_articles).toEqual(defaultSkill("plan_articles"));
  });
  const unit={unitId:"unit",revisionId:"revision",content:"ExampleCo requires hearing protection at 85 dB.",kind:"procedure" as const,epistemicStatus:"established" as const};
  it("uses the selected writing skill and retains claim-reference mapping",async()=>{
    const request=intercept({revise:[],retire:[],add:[{text:"Hearing protection is required at 85 dB.",claims:["C1"]}]});
    const writer=new TokenFactorySectionWriter({apiKey:"test",skills:{write_articles:custom,plan_articles:{...custom,instructions:"OTHER_STAGE_ONLY"}}});
    const result=await writer.reviseSection({pageTitle:"ExampleCo",sectionTitle:"Overview",units:[unit],lines:[],uncoveredUnitIds:["unit"],updateNote:"Use shorter sentences for this update."});
    expect(request().messages.filter((message: {role:string})=>message.role==="system").map((message: {content:string})=>message.content).join(" ")).toContain(custom.instructions);
    expect(request().messages.filter((message: {role:string})=>message.role==="system").map((message: {content:string})=>message.content).join(" ")).not.toContain("OTHER_STAGE_ONLY");
    expect(JSON.parse(request().messages.find((message: {role:string})=>message.role==="user").content).updateInstructions).toBe("Use shorter sentences for this update.");
    expect(result.add[0]?.unitIds).toEqual(["unit"]);
    expect(writer.promptVersion).toContain(`${custom.id}@3`);
  });
  it("uses planning assignments without changing verified claim inputs",async()=>{
    const request=intercept({title:"Noise protection",introduction:["C1"],sections:[{title:"Hearing protection",claims:["C1"]}]});
    await planArticle({apiKey:"test",skills:{plan_articles:custom}},{entity:{id:"company",name:"ExampleCo",type:"company",key:"exampleco"},units:[unit]});
    expect(request().messages.filter((message: {role:string})=>message.role==="system").map((message: {content:string})=>message.content).join(" ")).toContain(custom.instructions);
    expect(JSON.parse(request().messages.find((message: {role:string})=>message.role==="user").content).claims[0].content).toBe(unit.content);
  });
  it("applies extraction, entity, relationship, and topic assignments together",async()=>{
    const request=intercept({summary:"No changes",claims:[],links:[]});
    const skills:StageSkills={extract_knowledge:custom,identify_entities:{...custom,instructions:"ENTITY_SELECTION"},link_knowledge:{...custom,instructions:"RELATION_SELECTION"},organize_topics:{...custom,instructions:"TOPIC_SELECTION"}};
    await new TokenFactoryReconciliationClient({apiKey:"test",skills}).draftChangeSet({source:{id:"source",title:"source.txt",sourceDate:"2026-10-14"},passages:[{id:"p",position:0,text:unit.content,speakerLabel:null}],existingUnits:[],domainPaths:[],entities:[]});
    const system=request().messages.filter((message: {role:string})=>message.role==="system").map((message: {content:string})=>message.content).join(" ");
    for(const skill of Object.values(skills))expect(system).toContain(skill!.instructions);
    expect(JSON.parse(request().messages.find((message: {role:string})=>message.role==="user").content).passages[0].text).toBe(unit.content);
  });
});
