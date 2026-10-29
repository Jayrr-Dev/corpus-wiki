// Screenshot any static HTML at 1920x1080: node tools/shot.mjs frozen/upload.html out/x.png
import { spawn } from "node:child_process"; import { writeFileSync, existsSync } from "node:fs"; import { resolve } from "node:path"; import { pathToFileURL } from "node:url";
const [file, outPng] = process.argv.slice(2);
const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const port = 9800 + Math.floor(Math.random() * 150);
const ch = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("out/.p" + port)}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let tg;
for (let i = 0; i < 50 && !tg; i++) { await sleep(200); try { tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (P.has(d.id)) { P.get(d.id)(d); P.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; P.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pathToFileURL(resolve(file)).href }); await sleep(2500);
writeFileSync(outPng, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
ws.close(); ch.kill(); console.log(outPng);
