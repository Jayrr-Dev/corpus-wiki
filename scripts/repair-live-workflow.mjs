import { createServer } from 'vite';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root = process.cwd();
const runtime = await createServer({ configFile:false, appType:'custom', server:{middlewareMode:true,watch:null,hmr:false}, resolve:{alias:{'@':root,'server-only':join(root,'test/server-only.ts')}} });
try {
 const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
 const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
 const db=supabaseRpc(getAdminSupabase());
 const id='11ddece9-27c7-4784-bbe3-80302991bfe5';
 const before=await db.call('read_section_state',{p_section_id:id});
 if(before.title!=='Complete application workflow') throw Error('Unexpected section');
 const directory=resolve('artifacts/sections-live',`workflow-repair-${Date.now()}`);
 await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'before.json'),JSON.stringify(before,null,2));
 const {readModelChoice}=await runtime.ssrLoadModule('/lib/ai/models.ts');
 const {loadStageSkills}=await runtime.ssrLoadModule('/lib/ai/skills/server.ts');
 const {getSectionWriter}=await runtime.ssrLoadModule('/lib/living-page/index.ts');
 const {refreshSectionStyle}=await runtime.ssrLoadModule('/lib/living-page/refreshStyle.ts');
 const choice=await readModelChoice(db);
 const model='zai-org/GLM-5.3-Flash';
 const writer=getSectionWriter(process.env,{...choice,model,roleModels:{...choice.roleModels,write_articles:model,reviewer:model},roleEfforts:{...choice.roleEfforts,write_articles:'low',reviewer:'low'}},await loadStageSkills(db),call=>db.call('log_ai_call',{p_call:call}));
 const note=`Rewrite this complete section in end-to-end chronological order across ALL actors. Current prose incorrectly finishes the Designer lane before City circulation and incorrectly says conditions are resolved before City issues the permit. Correct both errors from the claims. Flow: preliminary design and permit determination; Drafting prepares drawings; Designer checks accuracy and sends corrections back to Drafting; online application and PDF; City acknowledges and circulates; stakeholders review and respond (objections branch to step 6; approval/comments branch to step 8); City approves and issues permit at source step 9; Designer receives permit and reviews conditions; conditions are resolved at step 11 if present, possibly requiring revision/resubmission; then source step 12 adds permit number and accompanying documents to drawing/work order, and records are scanned/filed. Preserve source step numbers only when explicitly supported, and distinguish them from your own list numbering. Interleave other actors between Designer steps while preserving relative Designer step order. Data lane software is context, NOT a numbered Designer action. Give diagram orientation briefly before the process and tools after it; do not restart preliminary design near the end. Consolidate repeated summaries. Preserve all 29 claims and their citations. The form-description claim mentioning inaccurate drawing resolution to City differs from the drawing-review claim returning corrections to Drafting: attribute the form-description separately without inventing a reconciliation. Do not repeat the Overview definition. Retire and replace lines as needed for coherent paragraph order.`;
 await refreshSectionStyle(db,writer,id,note + ' Additional personal review: do NOT create your own numbered sequence because it conflicts with the source step numbers in branches. Use chronological prose paragraphs or unnumbered phase bullets instead. Only source step numbers 6, 8, 9, 11 and 12 may appear as explicitly attributed source references. Describe stakeholder approval and objections as alternative branches, not successive mandatory actions. Put the general summary and flowchart orientation first, then preparation, submission, circulation branches, permit issuance, conditions, and final filing. Keep Data lane tools outside the procedural steps. End with a concise separately attributed note about the conflicting form description, without repeating the entire permit definition.');
 const after=await db.call('read_section_state',{p_section_id:id});
 await writeFile(join(directory,'after.json'),JSON.stringify(after,null,2));
 console.log(JSON.stringify({directory,lines:after.lines.map(l=>l.content),claims:after.units.length},null,2));
} finally {await runtime.close();}
