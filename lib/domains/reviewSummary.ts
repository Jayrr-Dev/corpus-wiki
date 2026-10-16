import { z } from "zod";

export const reviewSummarySchema = z.object({
  heading: z.string().min(1).max(90),
  groups: z.array(z.object({
    title: z.string().min(1).max(50),
    items: z.array(z.object({
      lead: z.string().min(1).max(70),
      detail: z.string().min(1).max(220),
    })).length(3),
  })).length(3),
});

export const REVIEW_SUMMARY_INSTRUCTIONS = `Write summary for a person deciding what to do, using plain language.
Use one heading and exactly three groups with three items each: current findings, decision needed, and next steps (adapt short noun-phrase group titles to the result).
Each lead is a capitalized imperative verb plus object that carries the point. Each detail is one concrete sentence ending in a period. Keep items similar in length, one or two lines. Use the same kind of verb within each group.
Do not put Markdown or colons in headings or leads. Cut filler such as "you can", "in order to", and "just". Do not invent facts or additional issues to fill the structure; use relevant evidence, uncertainty, scope and actual approval effects. For inspect, explain that approval only acknowledges the question and makes no structural change. For none, do not imply approval is needed. Distinguish proposed changes from completed changes. Do not include private internal reasoning.`;

export function formatReviewSummary(summary: z.infer<typeof reviewSummarySchema>): string {
  return `# ${summary.heading}\n\n` + summary.groups.map(group =>
    `**${group.title}**\n` + group.items.map(item => `- **${item.lead}:** ${item.detail}`).join("\n")
  ).join("\n\n");
}
