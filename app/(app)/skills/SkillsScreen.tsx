"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_STAGES, type AiSkill, type AiStage, type SkillLibrary } from "@/lib/ai/skills/types";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { archiveAiSkill, assignAiSkill, readAiSkills } from "@/lib/server-actions/skills";
import { SkillEditor } from "./SkillEditor";

type Editor={skill?:AiSkill;duplicate?:boolean};
export function SkillsScreen() {
  const library=useQuery({queryKey:["table","ai_skills","library"],queryFn:async()=>{
    const result=await readAiSkills(); if (!result.ok) throw new Error(result.error); return result;
  }});
  const [tab,setTab]=useState<"assignments"|"library">("assignments");
  const [editor,setEditor]=useState<Editor|null>(null);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-2xl text-panel text-muted-foreground">Choose how the AI handles each part of your knowledge workflow. Create your own instructions or duplicate a default skill. Changes apply to future runs.</p>
      <Button size="sm" onClick={()=>setEditor({})}>New skill</Button>
    </div>
    <div className="flex gap-2" role="group" aria-label="Skills views">
      <Button size="sm" variant={tab==="assignments"?"secondary":"ghost"} aria-pressed={tab==="assignments"} onClick={()=>setTab("assignments")}>Stage assignments</Button>
      <Button size="sm" variant={tab==="library"?"secondary":"ghost"} aria-pressed={tab==="library"} onClick={()=>setTab("library")}>Skill library</Button>
    </div>
    <QueryState query={library}>
      {library.data ? tab==="assignments" ? <Assignments library={library.data} onView={(skill)=>setEditor({skill})} /> : <SkillList library={library.data} onEdit={(skill)=>setEditor({skill})} onDuplicate={(skill)=>setEditor({skill,duplicate:true})} /> : null}
    </QueryState>
    {editor ? <SkillEditor key={`${editor.skill?.id??"new"}:${!!editor.duplicate}`} skill={editor.skill} duplicate={editor.duplicate} onClose={()=>setEditor(null)} onDuplicate={(skill)=>setEditor({skill,duplicate:true})} /> : null}
  </div>;
}

function Assignments({library,onView}:{library:SkillLibrary;onView:(skill:AiSkill)=>void}) {
  return <section aria-label="AI stage assignments" className="space-y-3">{AI_STAGES.map((stage)=>{
    const assignment=library.assignments.find((row)=>row.stage===stage.id);
    const current=assignment ? assignment.skill_id : defaultSkill(stage.id).id;
    return <StageRow key={`${stage.id}:${current}`} stage={stage} current={current} skills={library.skills.filter((skill)=>!skill.archived_at)} onView={onView} />;
  })}<p className="text-xs text-faint">Source citations, data validation, and revision checks remain part of the workflow for every skill.</p></section>;
}
function StageRow({stage,current,skills,onView}:{stage:(typeof AI_STAGES)[number];current:string|null;skills:AiSkill[];onView:(skill:AiSkill)=>void}) {
  const [selected,setSelected]=useState(current??"");
  const [saved,setSaved]=useState(false);
  const save=useServerAction(assignAiSkill);
  const selectedSkill=skills.find((skill)=>skill.id===selected);
  const apply=async(id:string|null)=>{const result=await save.run(stage.id as AiStage,id);if(result.ok)setSaved(true);};
  return <section aria-label={stage.name} className="rounded-lg border p-4">
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)]">
      <div><h2 className="font-semibold">{stage.name}</h2><p className="mt-1 text-panel text-muted-foreground">{stage.description}</p></div>
      <div className="space-y-2">
        <select aria-label={`Skill for ${stage.name}`} className="h-9 w-full rounded-md border bg-background px-2 text-panel" value={selected} disabled={save.isPending} onChange={(event)=>{setSelected(event.target.value);setSaved(false);}}>
          <option value="">App rules only</option>
          {skills.map((skill)=><option key={skill.id} value={skill.id}>{skill.name}{skill.id===defaultSkill(stage.id).id?" (default)":""} · v{skill.version}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={save.isPending||selected===(current??"")} onClick={()=>void apply(selected||null)}>{save.isPending?"Saving…":"Save assignment"}</Button>
          <Button size="sm" variant="ghost" disabled={!selectedSkill||save.isPending} onClick={()=>selectedSkill&&onView(selectedSkill)}>View skill</Button>
          <Button size="sm" variant="ghost" disabled={save.isPending||current===defaultSkill(stage.id).id} onClick={()=>void apply(defaultSkill(stage.id).id)}>Reset</Button>
          {saved?<span role="status" className="text-xs text-faint">Saved</span>:null}
        </div>
        {save.error?<p role="alert" className="text-panel text-failed">{save.error}</p>:null}
      </div>
    </div>
  </section>;
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
        <div><h2 className="font-semibold">{skill.name}</h2><p className="mt-1 text-xs text-faint">{skill.builtin_key?"Built in":"Custom"} · Version {skill.version}{skill.archived_at?" · Archived":used?` · Assigned to ${used} stage${used===1?"":"s"}`:" · Unassigned"}</p></div>
        <p className="flex-1 text-panel text-muted-foreground">{skill.description||"No description"}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={()=>onEdit(skill)}>{skill.builtin_key||skill.archived_at?"View":"Edit"}</Button>
          <Button size="sm" variant="outline" onClick={()=>onDuplicate(skill)}>Duplicate</Button>
          {!skill.builtin_key?<Button size="sm" variant="ghost" disabled={archive.isPending||!!used} title={used?"Assign another skill to these stages before archiving.":undefined} onClick={()=>void archive.run(skill.id,skill.version,!skill.archived_at)}>{skill.archived_at?"Restore":"Archive"}</Button>:null}
        </div>
      </article>;
    })}</div>
    {!matches.length?<p className="text-panel text-faint">No matching skills. Create one with New skill.</p>:null}
  </section>;
}
