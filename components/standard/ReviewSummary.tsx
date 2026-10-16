// A small, text-only renderer: model output never becomes HTML.
export function ReviewSummary({ text }: { text: string }) {
  return <div className="space-y-3 text-panel leading-relaxed">{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split("\n");
    const first = lines[0] ?? "";
    if (block.startsWith("# ")) return <h4 key={index} className="font-semibold">{block.slice(2)}</h4>;
    if (/^\*\*.+\*\*$/.test(first)) return <section key={index} className="space-y-1.5">
      <p><strong>{first.slice(2, -2)}</strong></p>
      <ul className="list-disc space-y-1.5 pl-5">{lines.slice(1).map((line, i) => {
        const item = /^- \*\*(.+?):\*\* (.+)$/.exec(line);
        return <li key={i}>{item ? <><strong>{item[1]}:</strong> {item[2]}</> : line}</li>;
      })}</ul>
    </section>;
    return <p key={index} className="whitespace-pre-line">{block}</p>;
  })}</div>;
}
