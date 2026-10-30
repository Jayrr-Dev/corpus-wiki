import { afterEach, expect, it, vi } from 'vitest';
import { chatJson } from '@/lib/ai/chat';
import { confirmFilingObjections, dropFixedIssues } from './filingObjections';
vi.mock('@/lib/ai/chat',()=>({chatJson:vi.fn()}));
afterEach(()=>vi.mocked(chatJson).mockReset());

it('retains a confirmed wrong placement while dismissing an optional alternative',async()=>{
 vi.mocked(chatJson).mockResolvedValue({value:{verdicts:[
  {issue:2,blocking:false,reason:'The current comparison child is defensible; the parent is an optional alternative.'},
  {issue:1,blocking:true,reason:'The current claim describes Six but is filed only under Four.'},
 ]},model:'test',tokensIn:10,tokensOut:5});
 const issues=['C1 describes Six but is filed under Four.','Move the coherent comparison group to its parent instead.'];
 const result=await confirmFilingObjections({apiKey:'test'},issues,{claims:[{ref:'C1',content:'Type Six seeks reassurance.'}],priorReviewIssues:[['Create the comparison child.']]});
 expect(result.issues).toEqual([issues[0]]);
 expect(result.tokensIn).toBe(10);
 expect(vi.mocked(chatJson).mock.calls[0]![1].name).toBe('independent_upload_domain_issue_check');
});

it.each([
 [{issue:1,blocking:false,reason:'Optional.'},{issue:1,blocking:false,reason:'Repeated.'}],
 [{issue:1,blocking:false,reason:'Optional.'},{issue:3,blocking:false,reason:'Unknown.'}],
 [{issue:1,blocking:false,reason:'Optional.'}],
].map(verdicts=>({verdicts})))('never accepts an incomplete or malformed objection check',async({verdicts})=>{
 vi.mocked(chatJson).mockResolvedValue({value:{verdicts},model:'test',tokensIn:1,tokensOut:1});
 await expect(confirmFilingObjections({apiKey:'test'},['First issue','Second issue'],{})).rejects.toThrow('issue');
});

const fixed="C1 is about Harbor Food Bank. It must not be placed under Eastside Food Bank/Forklift permits.";
it("drops an issue repeated word for word once its placement has moved",()=>{
 expect(dropFixedIssues([fixed],[[fixed]],new Set(["Harbor Food Bank/Forklift permits"]))).toEqual([]);
});
it("keeps a repeated issue the proposal still deserves",()=>{
 expect(dropFixedIssues([fixed],[[fixed]],new Set(["Eastside Food Bank/Forklift permits"]))).toEqual([fixed]);
});
it("keeps new issues, and repeats that name no path",()=>{
 const vague="C2 has no evidence for its owner.";
 expect(dropFixedIssues([fixed,vague],[[vague]],new Set(["Harbor Food Bank"]))).toEqual([fixed,vague]);
});
