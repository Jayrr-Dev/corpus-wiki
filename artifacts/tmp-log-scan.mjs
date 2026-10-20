import { readFileSync } from "node:fs";
const text = readFileSync(".next/dev/logs/next-development.log", "utf8");
const lines = text.split("\n").filter(Boolean);
console.log("lines", lines.length);
console.log("last", lines.at(-1)?.slice(0, 300));
const recent = lines.filter((line) => /19:1[0-6]/.test(line) && /outline|skipReview|compile|Error|suggestion/i.test(line));
console.log("recent", recent.length);
for (const line of recent.slice(-20)) {
  const time = line.match(/"timestamp":"([^"]+)"/)?.[1] ?? "";
  const message = line.match(/"message":"(.*)$/)?.[1]?.slice(0, 220) ?? line.slice(0, 220);
  console.log(time, message);
}
