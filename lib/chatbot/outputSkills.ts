export const OUTPUT_SKILL_IDS = ["natural", "bullets", "short", "steps", "explain", "compare"] as const;
export type OutputSkillId = typeof OUTPUT_SKILL_IDS[number];

export const OUTPUT_SKILLS: { id: OutputSkillId; label: string; description: string; instruction: string }[] = [
  { id: "natural", label: "Natural", description: "Clear, conversational, and humanized", instruction: "Use a natural conversational answer. Keep simple answers short. Use sections only when helpful." },
  { id: "bullets", label: "Bullet points", description: "Key points you can scan quickly", instruction: "Use a brief opening sentence and one section with an empty heading. Its body must contain 3-6 concise Markdown bullet points, each starting with '- ' on a new line. One idea per bullet. Avoid nested lists and repetition." },
  { id: "short", label: "Short answer", description: "The essentials in a few sentences", instruction: "Return only the answer field and its citations, with sections set to []. Write 2-3 sentences, at most 80 words. Answer directly without an introduction or closing offer." },
  { id: "steps", label: "Step by step", description: "An ordered plan with clear actions", instruction: "Use a short opening sentence. Each section is one sequential step with a heading such as '1. Check the label' and a body explaining the concrete action. Preserve safety conditions and prerequisites. Do not invent procedures unsupported by evidence." },
  { id: "explain", label: "Explain simply", description: "Plain language with a practical example", instruction: "Explain for a beginner using everyday words. Define unfamiliar terms and give one short, clearly hypothetical example. Use at most two sections. Keep the explanation under 180 words unless more detail is requested." },
  { id: "compare", label: "Compare", description: "Similarities, differences, and tradeoffs", instruction: "Compare the subjects using the same criteria. Use short sections for similarities, meaningful differences, and practical tradeoffs where supported. Do not use Markdown tables. Say when the evidence is insufficient to compare or choose." },
];

export function outputSkillInstruction(id: OutputSkillId): string {
  return `Selected output skill: ${OUTPUT_SKILLS.find(skill => skill.id === id)!.label}. Apply this format instead of the default section count or length. Preserve evidence, scope, and the humanized writing rules. An explicit format or length requested in the latest user message takes priority.\n${OUTPUT_SKILLS.find(skill => skill.id === id)!.instruction}`;
}
