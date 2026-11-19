import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";

const root = await realpath(fileURLToPath(new URL("../../src-web/dist", import.meta.url))).catch(() => {
  throw new Error("Web build missing. Run pnpm build:web first.");
});
const gateway = createGateway();
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};
const server = createServer((request, response) => {
  gateway.handle(request, response, () => { void serveStatic(request, response); });
});
server.on("upgrade", gateway.upgrade);

async function serveStatic(request, response) {
  try {
    const url = new URL(request.url, "http://web.invalid");
    if (url.pathname === "/web-config.json") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ gateway: "/_screeps/" }));
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const name = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = await realpath(resolve(root, `.${name}`));
    if (!file.startsWith(`${root}${sep}`)) throw new Error("Invalid path");
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "cache-control": name.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  } catch {
    if (!response.headersSent) response.writeHead(404).end("Not found");
  }
}

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => console.log(`Screeps Dashboard Web: http://${host}:${port}`));
