"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { AI_STAGES, type AiSkill, type AiStage, type SkillLibrary } from "@/lib/ai/skills/types";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { archiveAiSkill, assignAiSkill, readAiSkills } from "@/lib/server-actions/skills";
import { RolesTab } from "./RolesTab";
import { FlowsTab } from "./FlowsTab";
import { SkillEditor } from "./SkillEditor";

type Editor={skill?:AiSkill;duplicate?:boolean};
export function SkillsScreen() {
  const library=useQuery({queryKey:["table","ai_skills","library"],queryFn:async()=>{
    const result=await readAiSkills(); if (!result.ok) throw new Error(result.error); return result;
  }});
  const [tab,setTab]=useState<"assignments"|"library"|"flows"|"roles">("assignments");
  const [editor,setEditor]=useState<Editor|null>(null);
  const tabs=[{id:"assignments",label:"Stage assignments"},{id:"library",label:"Skill library",count:library.data?.skills.filter((skill)=>!skill.archived_at).length},{id:"flows",label:"Flows"},{id:"roles",label:"Roles"}] as const;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-2xl text-panel text-muted-foreground">Choose how the AI handles each part of your knowledge workflow. Create your own instructions or duplicate a default skill. Changes apply to future runs.</p>
      <Button size="sm" onClick={()=>setEditor({})}>New skill</Button>
    </div>
    <div role="tablist" aria-label="Workflow views" className="flex flex-wrap gap-1 border-b">
      {tabs.map((item)=>{const selected=item.id===tab;return <button key={item.id} type="button" role="tab" aria-selected={selected} onClick={()=>setTab(item.id)} className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-panel transition-colors",selected?"border-foreground font-medium text-foreground":"border-transparent text-muted-foreground hover:text-foreground")}>
        {item.label}{"count" in item&&item.count?<span className="rounded-sm bg-hover px-1.5 font-mono text-xs text-muted-foreground">{item.count}</span>:null}
      </button>;})}
    </div>
    <QueryState query={library}>
      {library.data ? tab==="flows" ? <FlowsTab library={library.data} onNavigate={setTab} /> : tab==="roles" ? <RolesTab library={library.data} /> : tab==="assignments" ? <Assignments library={library.data} onView={(skill)=>setEditor({skill})} /> : <SkillList library={library.data} onEdit={(skill)=>setEditor({skill})} onDuplicate={(skill)=>setEditor({skill,duplicate:true})} /> : null}
    </QueryState>
    {editor ? <SkillEditor key={`${editor.skill?.id??"new"}:${!!editor.duplicate}`} skill={editor.skill} duplicate={editor.duplicate} onClose={()=>setEditor(null)} onDuplicate={(skill)=>setEditor({skill,duplicate:true})} /> : null}
  </div>;
}

function Assignments({library,onView}:{library:SkillLibrary;onView:(skill:AiSkill)=>void}) {
  const skills=library.skills.filter((skill)=>!skill.archived_at);
  return <section aria-label="AI stage assignments" className="space-y-2">
    <ol className="divide-y overflow-hidden rounded-lg border">{AI_STAGES.map((stage,index)=>{
      const assignment=library.assignments.find((row)=>row.stage===stage.id);
      const current=assignment ? assignment.skill_id : defaultSkill(stage.id).id;
      return <StageRow key={`${stage.id}:${current}`} step={index+1} stage={stage} current={current} skills={skills} onView={onView} />;
    })}</ol>
    <p className="text-xs text-faint">Source citations, data validation, and revision checks remain part of the workflow for every skill.</p>
  </section>;
}
function StageRow({step,stage,current,skills,onView}:{step:number;stage:(typeof AI_STAGES)[number];current:string|null;skills:AiSkill[];onView:(skill:AiSkill)=>void}) {
  const [selected,setSelected]=useState(current??"");
  const [saved,setSaved]=useState(false);
  const save=useServerAction(assignAiSkill);
  const defaultId=defaultSkill(stage.id).id;
  const selectedSkill=skills.find((skill)=>skill.id===selected);
  const dirty=selected!==(current??"");
  const apply=async(id:string|null)=>{const result=await save.run(stage.id as AiStage,id);if(result.ok)setSaved(true);};
  return <li aria-label={stage.name} className="grid gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-hover/40 md:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] md:items-center">
    <div className="flex min-w-0 gap-3">
      <span aria-hidden="true" className="mt-px w-4 shrink-0 text-right font-mono text-xs leading-5 text-faint">{step}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-panel font-medium">{stage.name}</h2>
          {current===null?<Badge variant="outline">App rules only</Badge>:current!==defaultId?<Badge variant="secondary">Custom</Badge>:null}
        </div>
        <p className="mt-0.5 text-panel text-muted-foreground">{stage.description}</p>
      </div>
    </div>
    <div className="space-y-1.5 pl-7 md:pl-0">
      <div className="flex items-center gap-1">
        <NativeSelect aria-label={`Skill for ${stage.name}`} className="min-w-0 flex-1" value={selected} disabled={save.isPending} onChange={(event)=>{setSelected(event.target.value);setSaved(false);}}>
          <NativeSelectOption value="">App rules only</NativeSelectOption>
          {skills.map((skill)=><NativeSelectOption key={skill.id} value={skill.id}>{skill.name}{skill.id===defaultId?" (default)":""} · v{skill.version}</NativeSelectOption>)}
        </NativeSelect>
        <RowMenu label={selectedSkill?.name??"Skill"} items={[{label:"View",isDisabled:!selectedSkill,run:()=>selectedSkill&&onView(selectedSkill)}]} />
      </div>
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
