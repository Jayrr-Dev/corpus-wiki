"use client";

import { useState, type FormEvent } from "react";
import type { AiSkill } from "@/lib/ai/skills/types";
import { saveAiSkill } from "@/lib/server-actions/skills";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from "@/components/ui/dialog";

export function SkillEditor({skill,duplicate=false,onClose,onDuplicate}:{skill?:AiSkill;duplicate?:boolean;onClose:()=>void;onDuplicate:(skill:AiSkill)=>void}) {
  const readOnly=!!skill&&!duplicate&&(!!skill.builtin_key||!!skill.archived_at);
  const [name,setName]=useState(skill?`${skill.name}${duplicate?" copy":""}`:"");
  const [description,setDescription]=useState(skill?.description??"");
  const [instructions,setInstructions]=useState(skill?.instructions??"");
  const save=useServerAction(saveAiSkill);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    const result=await save.run({id:skill&&!duplicate?skill.id:null,expectedVersion:skill&&!duplicate?skill.version:null,name,description,instructions});
    if(result.ok)onClose();
  };
  return <Dialog open onOpenChange={(open)=>{if(!open&&!save.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{readOnly?skill?.name:skill&&!duplicate?"Edit skill":"New skill"}</DialogTitle><DialogDescription>{readOnly?"Duplicate this skill to make your own version.":"Describe what the AI should do at the stages you assign this skill to."}</DialogDescription></DialogHeader>
    <form onSubmit={(event)=>void submit(event)} className="space-y-4">
      <label className="block space-y-1 text-panel"><span>Name</span><Input required maxLength={100} value={name} readOnly={readOnly} disabled={save.isPending} onChange={(event)=>setName(event.target.value)} /></label>
      <label className="block space-y-1 text-panel"><span>Description</span><Input maxLength={500} value={description} readOnly={readOnly} disabled={save.isPending} onChange={(event)=>setDescription(event.target.value)} /></label>
      <label className="block space-y-1 text-panel"><span>Instructions</span><Textarea required maxLength={20000} value={instructions} readOnly={readOnly} disabled={save.isPending} onChange={(event)=>setInstructions(event.target.value)} className="h-72 resize-y" placeholder="For example: Use short paragraphs. Explain technical terms. Preserve exact thresholds and cite supporting claims." /></label>
      <p className="text-xs text-faint">{instructions.length.toLocaleString()} / 20,000 characters. Saved changes apply to future AI runs. Existing articles stay as they are until rebuilt.</p>
      {save.error?<p role="alert" className="text-panel text-failed">{save.error}</p>:null}
      <DialogFooter><Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>Close</Button>{readOnly&&skill?<Button type="button" onClick={()=>onDuplicate(skill)}>Duplicate and edit</Button>:<Button type="submit" disabled={save.isPending||!name.trim()||!instructions.trim()}>{save.isPending?"Saving…":"Save skill"}</Button>}</DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
