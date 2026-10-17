import { expect, it } from "vitest";
import { composerPromptContext } from "./promptContext";
import type { ComposerArticle, Composition } from "./compose";
const article: ComposerArticle = { title: "Safety", sourceUrl: "/p/safety", selectedSections: ["Noise"], paragraphs: [{id:"a",section:"Noise",text:"Use hearing protection above 85 dB."},{id:"b",section:"Other",text:"Complete factual evidence outside the selection."}], existingFigures:[{after:"b",learningGoal:"Explain workplace reporting"}], availableAssets: Array.from({length:40},(_,i)=>({id:String(i),title:`Hearing protection ${i}`,description:"Complete description",type:"photo",tags:[],origin:"external",attribution:"Creator",license:"Public domain"})) };
it("bounds the library without changing tools' source data or section evidence",()=>{
 const before=JSON.stringify(article), result=composerPromptContext(article);
 expect(result.paragraphs).toEqual([article.paragraphs[0]]);
 expect(result.availableAssets).toHaveLength(12);
 expect(result.existingFigures).toEqual(article.existingFigures);
 expect(JSON.stringify(article)).toBe(before);
});
it("retains cited evidence and complete metadata for a chosen asset outside the shortlist",()=>{
 const figures: Composition["figures"]=[{after:"a",evidence:["b"],assetId:"39",svg:"",caption:"Example",alt:"Example",learningGoal:"Recognize protection"}];
 const result=composerPromptContext(article,figures,"review");
 expect(result.paragraphs).toEqual(article.paragraphs);
 expect(result.availableAssets).toEqual([article.availableAssets![39]]);
 expect(composerPromptContext(article,figures).availableAssets.some(a=>a.id==="39")).toBe(true);
});
it("omits the unrelated library from pixel comparison but keeps all selected prose",()=>{
 const result=composerPromptContext(article,[],"vision");
 expect(result.availableAssets).toEqual([]);
 expect(result.paragraphs[0]!.text).toBe(article.paragraphs[0]!.text);
});
