// Short navigation labels are separate from authoritative claim text.
// Prefer a known subject, then a recognizable topic, rather than sentence fragments.
export function knowledgeLabel(content: string, hints: { subject?: string; topic?: string } = {}): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "Untitled knowledge";
  if (hints.subject) return compact(hints.subject.split(/\s+\/\s+/)[0]!);
  const topics: [RegExp, string][] = [
    [/job hazard analysis/i, "Job Hazard Analysis"],
    [/discipline policy|class [ab] violations/i, "Discipline policy"],
    [/hazard control hierarchy|control hierarchy of|hierarchy of.*controls/i, "Hazard control hierarchy"],
    [/\bPPE\b|personal protective equipment/i, /categor|basic|specialized/i.test(text) ? "PPE categories" : "Protective equipment"],
    [/modified work|return to work/i, "Modified work program"],
    [/hearing conservation/i, "Hearing Conservation Program"],
    [/WHMIS/i, "WHMIS training"],
    [/safety data sheets?|\bSDSs?\b/i, "Safety data sheets"],
    [/report.*(?:accident|incident|near miss)/i, "Incident reporting"],
    [/(?:violence|harassment)/i, /program reviews|review.*program at least annually/i.test(text) ? "Prevention program reviews" : "Violence and harassment prevention"],
    [/evacuation|emergency response/i, "Emergency response"],
    [/(?:workplace |documented |weekly |monthly )inspections/i, "Workplace inspections"],
    [/tailgate|safety meetings/i, "Safety meetings"],
    [/orientation/i, "Safety orientation"],
    [/(?:responsib|accountab|protection of workers)/i, "Worker safety responsibilities"],
    [/Health [&and ]+Safety Program.*review/i, "Safety program review"],
  ];
  const topic = topics.find(([pattern]) => pattern.test(text));
  if (topic) return topic[1];
  const named = [...text.matchAll(/\b[A-Z][A-Za-z-]+(?:\s+(?:[A-Z][A-Za-z-]+|&)){1,4}\b/g)]
    .map((match) => match[0]).find((phrase) => !/\b(?:Inc|Ltd|LLC|Solutions|Under|The|All|Every)\b/.test(phrase)
      && /\b(?:Analysis|Assessment|Policy|Program|Plan|Training|Equipment|Protection|Procedure|System|Management)\b/.test(phrase));
  if (named) return compact(named);
  if (hints.topic) return compact(hints.topic);
  return phraseLabel(text);
}

// Trims a phrase to a few title-cased words
function compact(value: string): string {
  const words = value.trim().split(/\s+/).slice(0, 5).join(" ").replace(/\s+(?:and|or|of|to|for|in|at|the|a)$/i, "");
  const short = words.length <= 48 ? words : words.slice(0,48).replace(/\s+\S*$/, "");
  return short.charAt(0).toUpperCase() + short.slice(1).replace(/[,:;.]+$/, "");
}

// A short phrase from the claim's own wording (subject and filler verbs dropped),
// used when a broad topic label would not tell claims apart
export function phraseLabel(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "Untitled knowledge";
  const label = text.replace(/^.*?\b(?:Inc\.|Ltd\.|LLC)\s*(?:'s)?\s*/i, "")
    .replace(/^(?:The company|The organization|The program|All employees|Employees|Supervisors|Workers)\s+/i, "")
    .replace(/^(?:is |are )?(?:required to |requires |provides |maintains |holds |uses |adopts |states that |must |shall )/i, "")
    .replace(/^(?:a |an |the |immediately )/i, "")
    .split(/[,;.]|\s+(?:before|after|with|including|because|which|that|to be|for|until|when|where)\s+/i)[0]!;
  return compact(label || text);
}
