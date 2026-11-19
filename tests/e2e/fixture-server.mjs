import { createHash } from "node:crypto";
import { createServer } from "node:http";

const rooms = { shard0: ["W1N1", "W2N1", "W3N1"], shard1: ["W1N1"], main: ["E2S3"] };
const failedRooms = new Set();
let intents = [];
let tick = 900001;
const terrain = (seed) => Array.from({ length: 2500 }, (_, i) => {
  const x = i % 50, y = Math.floor(i / 50);
  return x < 2 || y < 2 || x > 47 || y > 47 || ((x + seed * 7) % 17 < 3 && y % 14 < 10) ? "1" : (x + y + seed) % 13 < 4 ? "2" : "0";
}).join("");

function objects(room, shard) {
  const seed = room.charCodeAt(1) + (shard === "shard1" ? 4 : 0);
  const obj = (id, type, x, y, data = {}) => ({ _id: `${room}-${shard}-${id}`, room, type, x, y, user: "alice-id", actionLog: {}, ...data });
  return [
    obj("controller", "controller", 35, 30, { level: 6, progress: 160000, progressTotal: 1090000, ticksToDowngrade: 50000 }),
    obj("spawn", "spawn", 24, 23, { name: "Origin", hits: 5000, hitsMax: 5000, store: { energy: 200 }, energy: 200, storeCapacityResource: { energy: 300 } }),
    obj("storage", "storage", 26, 25, { store: { energy: 150000 + seed * 1200, H: 12000, XGH2O: 800, battery: 5000 }, storeCapacity: 1000000, hits: 10000, hitsMax: 10000 }),
    obj("terminal", "terminal", 28, 25, { store: { energy: 36000, U: 15000, power: 800 }, storeCapacity: 300000, hits: 3000, hitsMax: 3000, cooldown: 4 }),
    obj("tower", "tower", 24, 26, { store: { energy: 650 }, storeCapacityResource: { energy: 1000 }, hits: room === "W2N1" ? 300 : 3000, hitsMax: 3000 }),
    obj("lab", "lab", 23, 27, { mineralType: "XGH2O", mineralAmount: 2500, energy: 1200, storeCapacityResource: { energy: 2000, XGH2O: 3000 }, hits: 500, hitsMax: 500 }),
    obj("rampart", "rampart", 24, 23, { hits: 500000, hitsMax: 10000000, isPublic: false }),
    obj("rampart2", "rampart", 25, 23, { hits: 600000, hitsMax: 10000000, isPublic: false }),
    obj("source", "source", 10, 12, { energy: 2400, energyCapacity: 3000, ticksToRegeneration: 130, user: undefined }),
    obj("source2", "source", 40, 15, { energy: 1200, energyCapacity: 3000, user: undefined }),
    obj("mineral", "mineral", 12, 38, { mineralType: "U", mineralAmount: 43000, user: undefined, ticksToRegeneration: 40000 }),
    obj("creep", "creep", 25, 25, { name: `Harvester-${room}`, hits: 500, hitsMax: 500, ticksToLive: 1250, memory: { role: "harvester" }, body: [{ type: "work", hits: 100 }, { type: "move", hits: 100 }, { type: "carry", hits: 100 }], store: { energy: 50 } }),
    obj("hauler", "creep", 27, 24, { name: `Hauler-${room}`, hits: 300, hitsMax: 300, ticksToLive: 900, memory: { role: "hauler" }, body: [{ type: "move", hits: 100 }, { type: "carry", hits: 100 }], store: { energy: 100 } }),
    obj("site", "constructionSite", 25, 28, { structureType: "extension", progress: 600, progressTotal: 3000 }),
    ...Array.from({ length: 10 }, (_, i) => obj(`road${i}`, "road", 20 + i, 24, { hits: 500, hitsMax: 500 })),
    ...(room === "W3N1" ? [obj("enemy", "creep", 10, 25, { user: "bob-id", name: "Visitor", body: [{ type: "move", hits: 100 }], hits: 100, hitsMax: 100 })] : []),
  ];
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body = {};
  try { body = JSON.parse(raw); } catch { /* GET requests do not have a body. */ }
  const json = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  if (url.pathname === "/test/reset") { intents = []; failedRooms.clear(); return json({ ok: 1 }); }
  if (url.pathname === "/test/fail") { failedRooms.add(body.room); return json({ ok: 1 }); }
  if (url.pathname === "/test/intents") return json(intents);
  if (url.pathname === "/api/user/rooms") return json({ ok: 1, shards: rooms });
  if (["/api/auth/me", "/api/user/me"].includes(url.pathname)) return json({ ok: 1, _id: "alice-id", username: "Alice", cpu: 100 });
  if (url.pathname.includes("/shards")) return json({ ok: 1, shards: Object.keys(rooms).map((name) => ({ name })) });
  if (url.pathname === "/api/game/room-terrain") return json({ ok: 1, terrain: [{ room: url.searchParams.get("room"), terrain: terrain((url.searchParams.get("room") ?? "W1N1").charCodeAt(1)) }] });
  if (url.pathname === "/api/game/room-objects") {
    const room = url.searchParams.get("room") ?? body.room;
    const shard = url.searchParams.get("shard") ?? body.shard ?? "shard0";
    if (room === "W9N9" || failedRooms.has(room)) return json({ error: "Room not visible in this shard" }, 403);
    return json({ ok: 1, gameTime: tick++, objects: objects(room, shard), users: { "alice-id": { _id: "alice-id", username: "Alice" }, "bob-id": { _id: "bob-id", username: "Bob" } } });
  }
  if (["/api/game/add-object-intent", "/api/game/create-construction"].includes(url.pathname)) {
    intents.push({ endpoint: url.pathname, body });
    return json({ ok: 1 });
  }
  if (url.pathname === "/api/user/badge-svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="24" fill="#8ba3ff"/></svg>'); }
  json({ error: "fixture endpoint not found" }, 404);
});

// The dashboard opens realtime as soon as the room detail page mounts. The
// fixture only needs a valid WebSocket handshake; room snapshots remain HTTP
// fixtures, and text commands can safely be ignored here.
server.on("upgrade", (request, socket) => {
  try {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.on("error", () => socket.destroy());
    socket.on("data", () => {
      // Commands such as auth/subscribe are intentionally ignored.
    });
  } catch {
    socket.destroy();
  }
});

server.listen(Number(process.env.FIXTURE_PORT ?? 5341), "127.0.0.1");
