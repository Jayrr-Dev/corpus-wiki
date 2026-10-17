"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { InfoPopover } from "@/components/standard/info-popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { AI_STAGES, type AiSkill, type AiStage, type SkillLibrary } from "@/lib/ai/skills/types";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { archiveAiSkill, assignAiSkill, readAiSkills } from "@/lib/server-actions/skills";
import { WorkflowOverview } from "./WorkflowOverview";

const FlowsTab = dynamic(() => import("./FlowsTab").then((module) => module.FlowsTab));
const AiFlowTab = dynamic(() => import("./AiFlowTab").then((module) => module.AiFlowTab));
const SkillEditor = dynamic(() => import("./SkillEditor").then((module) => module.SkillEditor));
import type { CanvasTab } from "./FlowCanvas";

type Editor={skill?:AiSkill;duplicate?:boolean};
export function SkillsScreen() {
  const [tab,setTab]=useState<"overview"|"assignments"|"library"|"flows"|"ai-flow">("overview");
  const library=useQuery({enabled:tab!=="overview",queryKey:["table","ai_skills","library"],queryFn:async()=>{
    const result=await readAiSkills(); if (!result.ok) throw new Error(result.error); return result;
  }});
  const router=useRouter();
  const [editor,setEditor]=useState<Editor|null>(null);
  const tabs=[{id:"overview",label:"Workflow overview"},{id:"assignments",label:"Skill assignments"},{id:"library",label:"Skill library",count:library.data?.skills.filter((skill)=>!skill.archived_at).length},{id:"flows",label:"Pipeline diagrams"},{id:"ai-flow",label:"AI handoffs"}] as const;
  // The canvases link to a role's card, which lives on Agent Roles
  const navigate=(target:CanvasTab)=>target==="roles"?router.push("/roles"):setTab(target);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b">
      <div data-tour="workflow-tabs" role="tablist" aria-label="Workflow views" className="flex flex-wrap gap-1" onKeyDown={(event)=>{
        const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current=buttons.indexOf(event.target as HTMLButtonElement);
        if(current<0)return;
        const next=event.key==="ArrowRight"?(current+1)%tabs.length:event.key==="ArrowLeft"?(current-1+tabs.length)%tabs.length:event.key==="Home"?0:event.key==="End"?tabs.length-1:null;
        if(next!==null){event.preventDefault();setTab(tabs[next]!.id);buttons[next]?.focus();}
      }}>
        {tabs.map((item)=>{const selected=item.id===tab;return <button key={item.id} type="button" role="tab" id={`workflow-tab-${item.id}`} aria-controls="workflow-panel" tabIndex={selected?0:-1} aria-selected={selected} onClick={()=>setTab(item.id)} className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-panel transition-colors",selected?"border-foreground font-medium text-foreground":"border-transparent text-muted-foreground hover:text-foreground")}>
          {item.label}{"count" in item&&item.count?<span className="rounded-sm bg-hover px-1.5 font-mono text-xs text-muted-foreground">{item.count}</span>:null}
        </button>;})}
      </div>
      <div className="ml-auto flex items-center gap-3 pb-1.5">
        <InfoPopover label="About the workflow">
          <p>The overview covers the complete system, including built-in steps and approvals. Skill assignments configure seven reusable instruction sets; Agent Roles overrides take precedence. Changes apply to future runs.</p>
        </InfoPopover>
        {tab==="assignments"||tab==="library"?<Button size="sm" onClick={()=>setEditor({})}>New skill</Button>:null}
      </div>
    </div>
    <div id="workflow-panel" role="tabpanel" aria-labelledby={`workflow-tab-${tab}`} tabIndex={0} className="outline-none">
    {tab==="overview"?<WorkflowOverview onAssignments={()=>setTab("assignments")} />:<QueryState query={library}>
      {library.data ? tab==="flows" ? <FlowsTab library={library.data} onNavigate={navigate} /> : tab==="ai-flow" ? <AiFlowTab library={library.data} onNavigate={navigate} /> : tab==="assignments" ? <Assignments library={library.data} onView={(skill)=>setEditor({skill})} /> : <SkillList library={library.data} onEdit={(skill)=>setEditor({skill})} onDuplicate={(skill)=>setEditor({skill,duplicate:true})} /> : null}
    </QueryState>}
    </div>
    {editor ? <SkillEditor key={`${editor.skill?.id??"new"}:${!!editor.duplicate}`} skill={editor.skill} duplicate={editor.duplicate} onClose={()=>setEditor(null)} onDuplicate={(skill)=>setEditor({skill,duplicate:true})} /> : null}
  </div>;
}

function Assignments({library,onView}:{library:SkillLibrary;onView:(skill:AiSkill)=>void}) {
  const skills=library.skills.filter((skill)=>!skill.archived_at);
  return <section aria-label="Skill assignments" className="space-y-2">
    <p className="text-xs text-muted-foreground">Assign reusable instructions to seven AI capabilities. The first five guide one shared reconciliation request; they do not run as separate steps. Agent Roles instructions take precedence.</p>
    <ul className="divide-y overflow-hidden rounded-lg border">{AI_STAGES.map((stage)=>{
      const assignment=library.assignments.find((row)=>row.stage===stage.id);
      const current=assignment ? assignment.skill_id : defaultSkill(stage.id).id;
      return <StageRow key={`${stage.id}:${current}`} stage={stage} overridden={!!library.roleInstructions?.some((item)=>item.role===stage.id)} current={current} skills={skills} onView={onView} />;
    })}</ul>
    <p className="text-xs text-faint">Source citations, data validation, and revision checks remain part of the workflow for every skill.</p>
  </section>;
}
function StageRow({stage,overridden,current,skills,onView}:{overridden:boolean;stage:(typeof AI_STAGES)[number];current:string|null;skills:AiSkill[];onView:(skill:AiSkill)=>void}) {
  const [selected,setSelected]=useState(current??"");
  const [saved,setSaved]=useState(false);
  const save=useServerAction(assignAiSkill);
  const defaultId=defaultSkill(stage.id).id;
  const selectedSkill=skills.find((skill)=>skill.id===selected);
  const dirty=selected!==(current??"");
  const apply=async(id:string|null)=>{const result=await save.run(stage.id as AiStage,id);if(result.ok)setSaved(true);};
  return <li aria-label={stage.name} className="grid gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-hover/40 md:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] md:items-center">
    <div className="flex min-w-0 gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-panel font-medium">{stage.name}</h2>
          {overridden?<Badge variant="outline">Agent Roles override active</Badge>:null}
          {current===null?<Badge variant="outline">App rules only</Badge>:current!==defaultId?<Badge variant="secondary">Custom</Badge>:null}
        </div>
        <p className="mt-0.5 text-panel text-muted-foreground">{stage.description}</p>
      </div>
    </div>
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <NativeSelect aria-label={`Skill for ${stage.name}`} className="min-w-0 flex-1" value={selected} disabled={save.isPending} onChange={(event)=>{setSelected(event.target.value);setSaved(false);}}>
          <NativeSelectOption value="">App rules only</NativeSelectOption>
          {skills.map((skill)=><NativeSelectOption key={skill.id} value={skill.id}>{skill.name}{skill.id===defaultId?" (default)":""} · v{skill.version}</NativeSelectOption>)}
        </NativeSelect>
        <RowMenu label={selectedSkill?.name??"Skill"} items={[{label:"View",isDisabled:!selectedSkill,run:()=>selectedSkill&&onView(selectedSkill)}]} />
      </div>
      {overridden?<p className="text-xs text-muted-foreground">This skill is inactive while the <Link href="/roles" className="underline underline-offset-4">Agent Roles override</Link> is active.</p>:null}
      {dirty||saved||save.error||current!==defaultId?<div className="flex flex-wrap items-center gap-2 text-xs">
        {dirty?<>
          <Button size="sm" disabled={save.isPending} onClick={()=>void apply(selected||null)}>{save.isPending?"Saving…":"Save"}</Button>
          <Button size="sm" variant="ghost" disabled={save.isPending} onClick={()=>setSelected(current??"")}>Cancel</Button>
        </>:current!==defaultId?<button type="button" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50" disabled={save.isPending} onClick={()=>void apply(defaultId)}>Reset to default</button>:null}
        {saved&&!dirty?<span role="status" className="text-faint">Saved</span>:null}
        {save.error?<p role="alert" className="text-failed">{save.error}</p>:null}
      </div>:null}
    </div>
  </li>;
}
function SkillList({library,onEdit,onDuplicate}:{library:SkillLibrary;onEdit:(skill:AiSkill)=>void;onDuplicate:(skill:AiSkill)=>void}) {
  const [search,setSearch]=useState("");
  const [showArchived,setShowArchived]=useState(false);
  const archive=useServerAction(archiveAiSkill);
  const matches=library.skills.filter((skill)=>(showArchived||!skill.archived_at)&&`${skill.name} ${skill.description}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Skill library" className="space-y-3">
    <div className="flex flex-wrap items-center gap-4"><Input aria-label="Search skills" placeholder="Search skills…" value={search} onChange={(event)=>setSearch(event.target.value)} className="max-w-sm" /><label className="flex items-center gap-2 text-panel"><input type="checkbox" checked={showArchived} onChange={(event)=>setShowArchived(event.target.checked)} />Show archived</label></div>
    {archive.error?<p role="alert" className="text-panel text-failed">{archive.error}</p>:null}
    <div className="grid gap-3 md:grid-cols-2">{matches.map((skill)=>{
      const used=library.assignments.filter((row)=>row.skill_id===skill.id).length;
      return <article key={skill.id} aria-label={skill.name} className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-2">
          <div><h2 className="font-semibold">{skill.name}</h2><p className="mt-1 text-xs text-faint">{skill.builtin_key?"Built in":"Custom"} · Version {skill.version}{skill.archived_at?" · Archived":used?` · Assigned to ${used} stage${used===1?"":"s"}`:" · Unassigned"}</p></div>
          <RowMenu label={skill.name} items={[
            {label:"Duplicate",run:()=>onDuplicate(skill)},
            ...(!skill.builtin_key?[{label:skill.archived_at?"Restore":"Archive",isDisabled:archive.isPending||!!used,title:used?"Assign another skill to these stages before archiving.":undefined,run:()=>void archive.run(skill.id,skill.version,!skill.archived_at)}]:[]),
          ]} />
        </div>
        <p className="flex-1 text-panel text-muted-foreground">{skill.description||"No description"}</p>
        <div><Button size="sm" variant="outline" onClick={()=>onEdit(skill)}>{skill.builtin_key||skill.archived_at?"View":"Edit"}</Button></div>
      </article>;
    })}</div>
    {!matches.length?<p className="text-panel text-faint">No matching skills. Create one with New skill.</p>:null}
  </section>;
}
