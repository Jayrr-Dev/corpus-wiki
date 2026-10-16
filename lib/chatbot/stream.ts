// Decode only the answer string, never the JSON envelope or model reasoning.
export function partialAnswer(json: string): string {
  const intro = partialField(json, "answer");
  const sections = json.indexOf('"sections"');
  if (sections < 0) return intro;
  const blocks = [...json.slice(sections).matchAll(/"heading"\s*:\s*"/g)];
  return [intro, ...blocks.map((match, index) => {
    const section = json.slice(sections + match.index, index + 1 < blocks.length ? sections + blocks[index + 1]!.index : undefined);
    const heading = partialField(section, "heading");
    const body = partialField(section, "body");
    return `${heading ? `### ${heading}` : ""}${body ? `\n\n${body}` : ""}`;
  })].filter(Boolean).join("\n\n");
}

function partialField(json: string, field: string): string {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!match) return "";
  const start = match.index + match[0].length;
  let end = start;
  for (; end < json.length; end++) {
    if (json[end] === "\\") {
      if (end + 1 >= json.length) break;
      if (json[end + 1] === "u" && json.length - end < 6) break;
      end += json[end + 1] === "u" ? 5 : 1;
      continue;
    }
    if (json[end] === '"') break;
  }
  const value = json.slice(start, end);
  try { return JSON.parse(`"${value}"`) as string; } catch { return ""; }
}
