import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
createServer(async (req, res) => {
  if (req.method !== "GET" || !["/", "/demo.html"].includes(req.url)) { res.writeHead(404).end(); return; }
  try {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(await readFile(new URL("./results/demo.html", import.meta.url)));
  } catch { res.end("Run the Composer benchmark first."); }
}).listen(0, "127.0.0.1", function () { console.log(`Composer demo: http://127.0.0.1:${this.address().port}/`); });
