import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["/", "review.html"], ["/report.html", "report.html"], ["/review.html", "review.html"],
  ["/tablet.json", "tablet.json"], ["/school-colors.json", "school-colors.json"],
  ["/personal-review.json", "../personal-review.json"],
]);
const server = createServer(async (request, response) => {
  const filename = files.get(new URL(request.url ?? "/", "http://localhost").pathname);
  if (request.method !== "GET" || !filename) { response.writeHead(404).end("Not found"); return; }
  try {
    const bytes = await readFile(new URL(`./results/${filename}`, import.meta.url));
    response.writeHead(200, { "Content-Type": filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(bytes);
  } catch { response.writeHead(404).end("Run the sandbox first."); }
});
server.listen(0, "127.0.0.1", () => { console.log(`Sections sandbox: http://127.0.0.1:${server.address().port}/`); });
