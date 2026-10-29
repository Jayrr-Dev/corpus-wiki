// Run a JS expression against a static page in headless Chrome and print the result as JSON.
// Usage: node tools/eval.mjs frozen/page.html "document.title"
import { spawn } from "node:child_process"; import { existsSync } from "node:fs"; import { resolve } from "node:path"; import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const [file, exprArg] = process.argv.slice(2); const expr = exprArg.startsWith("@") ? readFileSync(exprArg.slice(1), "utf8") : exprArg;
const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const port = 9950 + Math.floor(Math.random() * 40);
const ch = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("out/.e" + port)}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let tg;
for (let i = 0; i < 50 && !tg; i++) { await sleep(200); try { tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (P.has(d.id)) { P.get(d.id)(d); P.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; P.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pathToFileURL(resolve(file)).href + "?render" }); await sleep(1500);
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(r.result?.exceptionDetails ? r.result.exceptionDetails.exception?.description : r.result?.result?.value, null, 1));
ws.close(); ch.kill();
