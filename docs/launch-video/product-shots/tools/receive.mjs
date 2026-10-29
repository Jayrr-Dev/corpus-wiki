// Local-only receiver: the app page POSTs its HTML/CSS here and it is saved under snapshots/.
// Usage: node tools/receive.mjs   (listens on 127.0.0.1:4599)
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("snapshots", { recursive: true });
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") { res.end("ok"); return; }
  const name = new URL(req.url, "http://x").searchParams.get("name").replace(/[^a-z0-9._-]/gi, "");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => { writeFileSync(`snapshots/${name}`, Buffer.concat(chunks)); console.log("saved", name, Buffer.concat(chunks).length); res.end("saved"); });
}).listen(4599, "127.0.0.1", () => console.log("listening on 4599"));
