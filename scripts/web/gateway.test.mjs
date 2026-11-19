import { createServer, request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGateway,
  allowedServers,
  normalizeServer,
  MAX_GATEWAY_REQUEST_BODY_BYTES,
} from "./gateway.mjs";

const running = [];
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  running.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  })));
});

describe("same-origin Screeps Web gateway", () => {
  it("forwards JSON bodies and token headers without forwarding browser cookies", async () => {
    const seen = [];
    const upstream = await listen(createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "secret=1" });
        res.end(JSON.stringify({ ok: 1 }));
      });
    }));
    const gateway = createGateway(allowedServers(`${upstream}/world`));
    const base = await listen(createServer((req, res) => gateway.handle(req, res, () => res.writeHead(404).end())));
    const response = await fetch(`${base}/_screeps/${encodeURIComponent(`${upstream}/world`)}/api/game/add-object-intent?shard=main`, {
      method: "POST", headers: { "content-type": "application/json", "x-token": "test-only", cookie: "browser-session=1", origin: base }, body: JSON.stringify({ room: "W1N1", intent: { isPublic: false } }),
    });
    expect(await response.json()).toEqual({ ok: 1 });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seen[0].headers["x-token"]).toBe("test-only");
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].url).toBe("/world/api/game/add-object-intent?shard=main");
    expect(JSON.parse(seen[0].body)).toEqual({ room: "W1N1", intent: { isPublic: false } });
  });

  it("blocks unconfigured upstreams, cross-origin calls and non-API paths", async () => {
    const gateway = createGateway(allowedServers("https://screeps.com"));
    const base = await listen(createServer((req, res) => gateway.handle(req, res)));
    for (const path of [
      `${encodeURIComponent("http://127.0.0.1:1")}/api/auth/me`,
      `${encodeURIComponent("https://screeps.com")}/admin`,
      `${encodeURIComponent("https://screeps.com")}/api/%2e%2e%2fadmin`,
    ]) {
      expect((await fetch(`${base}/_screeps/${path}`)).status).toBe(403);
    }
    expect((await fetch(`${base}/_screeps/${encodeURIComponent("https://screeps.com")}/api/auth/me`, { headers: { origin: "https://other.example" } })).status).toBe(403);
  });

  it("rejects redirects instead of forwarding the token to a new upstream", async () => {
    const upstream = await listen(createServer((_req, res) => res.writeHead(302, { location: "http://127.0.0.1:1" }).end()));
    const gateway = createGateway(allowedServers(upstream));
    const base = await listen(createServer(gateway.handle));
    expect((await fetch(`${base}/_screeps/${encodeURIComponent(upstream)}/api/auth/me`)).status).toBe(502);
  });

  it("limits request bodies before they can be forwarded upstream", async () => {
    let upstreamCalls = 0;
    const upstream = await listen(createServer((_req, res) => {
      upstreamCalls += 1;
      res.writeHead(200).end("ok");
    }));
    const gateway = createGateway(allowedServers(upstream));
    const base = await listen(createServer((req, res) => gateway.handle(req, res)));
    const response = await fetch(`${base}/_screeps/${encodeURIComponent(upstream)}/api/game/add-object-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(MAX_GATEWAY_REQUEST_BODY_BYTES) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("1 MiB") });
    expect(upstreamCalls).toBe(0);
  });

  it("tunnels a WebSocket handshake and upstream frames", async () => {
    const upstreamServer = createServer();
    let upstreamSocket;
    let clientSocket;
    upstreamServer.on("upgrade", (req, socket) => {
      upstreamSocket = socket;
      const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 2, 0x6f, 0x6b]));
    });
    const upstream = await listen(upstreamServer);
    const gateway = createGateway(allowedServers(upstream));
    const gatewayServer = createServer(gateway.handle);
    gatewayServer.on("upgrade", gateway.upgrade);
    const base = await listen(gatewayServer);
    try {
      const data = await new Promise((resolve, reject) => {
        const req = httpRequest(`${base}/_screeps/${encodeURIComponent(upstream)}/socket/websocket`, { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", origin: base } });
        req.on("error", reject);
        req.on("upgrade", (res, socket, head) => {
          clientSocket = socket;
          expect(res.statusCode).toBe(101);
          if (head.length) resolve(head);
          else socket.once("data", resolve);
        });
        req.end();
      });
      expect(Buffer.from(data).subarray(-2).toString()).toBe("ok");
    } finally { clientSocket?.destroy(); upstreamSocket?.destroy(); }
  });

  it("normalizes configured URLs and rejects embedded credentials", () => {
    expect(normalizeServer("http://localhost:21025/world/")).toBe("http://localhost:21025/world");
    expect(() => normalizeServer("https://user:password@example.com")).toThrow();
  });
});
