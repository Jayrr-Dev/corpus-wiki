// Renders a scene HTML to a 1920x1080 MP4, frame by frame, with headless Chrome and ffmpeg.
// Usage: node render.mjs 17-upload.html [fps=30] [--still=2.5]
// Needs Node 22+ (built-in WebSocket), Chrome or Edge, and ffmpeg on PATH. No npm packages.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";

const [file, fpsArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const still = process.argv.find((a) => a.startsWith("--still="))?.split("=")[1];
const fps = Number(fpsArg || 30);
if (!file) { console.error("usage: node render.mjs <scene.html> [fps] [--still=t]"); process.exit(1); }

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const browserPath = BROWSERS.find(existsSync);
const port = 9300 + Math.floor(Math.random() * 500);
const profile = resolve("out/.chrome-profile-" + port);
const chrome = spawn(browserPath, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url: pathToFileURL(resolve(file)).href + "?render" });
for (let i = 0; i < 100 && !(await evaluate("window.__ready === true")); i++) await sleep(100);
await evaluate("document.fonts.ready.then(() => true)");
await sleep(300);

const duration = await evaluate("SCENE.duration");
mkdirSync("out", { recursive: true });
const name = basename(file, ".html");
const shot = async () => Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64");

if (still !== undefined) {
  await evaluate(`SCENE.frame(${Number(still)})`);
  writeFileSync(`out/${name}-${still}.png`, await shot());
  console.log(`out/${name}-${still}.png`);
} else {
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", `out/${name}.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(duration * fps);
  for (let f = 0; f <= frames; f++) {
    await evaluate(`SCENE.frame(${(f / fps).toFixed(4)})`);
    const png = await shot();
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`out/${name}.mp4  ${frames + 1} frames, ${duration}s`);
}
ws.close(); chrome.kill();
