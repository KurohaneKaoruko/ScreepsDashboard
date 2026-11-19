import http from "node:http";
import https from "node:https";

export const GATEWAY_PREFIX = "/_screeps/";
export const MAX_GATEWAY_REQUEST_BODY_BYTES = 1024 * 1024;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "cookie", "set-cookie",
]);

export function normalizeServer(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Server URLs must use HTTP(S), without credentials, query, or fragment.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function allowedServers(value = process.env.SCREEPS_ALLOWED_SERVERS ?? "https://screeps.com") {
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean).map(normalizeServer));
}

function targetFor(rawUrl, servers) {
  const url = new URL(rawUrl, "http://gateway.invalid");
  if (!url.pathname.startsWith(GATEWAY_PREFIX)) return null;
  const rest = url.pathname.slice(GATEWAY_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) throw new Error("Invalid gateway request.");
  const server = normalizeServer(decodeURIComponent(rest.slice(0, slash)));
  if (!servers.has(server)) throw new Error("This Screeps server is not in SCREEPS_ALLOWED_SERVERS.");
  const endpoint = rest.slice(slash);
  const decoded = decodeURIComponent(endpoint);
  if (!/^\/(api|socket)\//.test(decoded) || /[\\\r\n]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Invalid Screeps endpoint.");
  }
  return new URL(`${server}${endpoint}${url.search}`);
}

function sameOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function proxyHeaders(request, target, upgrade = false) {
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!HOP_HEADERS.has(key) && !["host", "origin", "referer", "accept-encoding"].includes(key) && !key.startsWith("sec-fetch-") && value !== undefined) {
      headers[key] = value;
    }
  }
  headers.host = target.host;
  headers["accept-encoding"] = "identity";
  if (upgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
    headers.origin = target.origin;
  }
  return headers;
}

function fail(response, status, message) {
  if (response.headersSent) return response.destroy();
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: message }));
}

/** Only explicitly configured servers are reachable; credentials are never logged or stored. */
export function createGateway(servers = allowedServers()) {
  function handle(request, response, next) {
    if (!request.url?.startsWith(GATEWAY_PREFIX)) return next?.();
    if (!sameOrigin(request)) return fail(response, 403, "Cross-origin gateway requests are not allowed.");
    if (!METHODS.has(request.method ?? "GET")) return fail(response, 405, "Unsupported method.");
    let target;
    try { target = targetFor(request.url, servers); } catch (error) { return fail(response, 403, error.message); }
    const declaredLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_GATEWAY_REQUEST_BODY_BYTES) {
      request.resume();
      return fail(response, 413, "Request body exceeds the 1 MiB Web gateway limit.");
    }
    const transport = target.protocol === "https:" ? https : http;
    const upstream = transport.request(target, {
      method: request.method,
      headers: proxyHeaders(request, target),
      timeout: 25_000,
    }, (result) => {
      // Do not follow redirects: a server cannot redirect a token to another host.
      if (result.statusCode >= 300 && result.statusCode < 400) {
        result.resume();
        return fail(response, 502, "Upstream redirects are not supported. Use the server's final API URL.");
      }
      const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
      for (const key of ["content-type", "content-length", "content-encoding", "x-token", "retry-after"]) {
        if (result.headers[key] !== undefined) headers[key] = result.headers[key];
      }
      response.writeHead(result.statusCode ?? 502, headers);
      result.on("error", () => response.destroy());
      result.pipe(response);
    });
    let requestBytes = 0;
    let oversized = false;
    request.on("data", (chunk) => {
      if (oversized) return;
      requestBytes += chunk.length;
      if (requestBytes <= MAX_GATEWAY_REQUEST_BODY_BYTES) return;
      oversized = true;
      request.unpipe(upstream);
      upstream.destroy();
      request.resume();
      fail(response, 413, "Request body exceeds the 1 MiB Web gateway limit.");
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Upstream timeout")));
    upstream.on("error", () => {
      if (!oversized) fail(response, 502, "Unable to reach the configured Screeps server.");
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
    request.pipe(upstream);
  }

  function upgrade(request, socket, head) {
    if (!request.url?.startsWith(GATEWAY_PREFIX)) return;
    let target;
    try {
      if (!sameOrigin(request)) throw new Error("Origin rejected");
      target = targetFor(request.url, servers);
      if (!target.pathname.includes("/socket/")) throw new Error("Not a socket endpoint");
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const transport = target.protocol === "https:" ? https : http;
    const upstream = transport.request(target, { headers: proxyHeaders(request, target, true), timeout: 25_000 });
    upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      upstreamSocket.setTimeout(0);
      const headers = Object.entries(response.headers).filter(([key]) => !["set-cookie"].includes(key));
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("error", () => upstreamSocket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.on("response", (response) => { response.resume(); socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); });
    upstream.on("error", () => socket.destroy());
    upstream.on("timeout", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.end();
  }

  return { handle, upgrade };
}
