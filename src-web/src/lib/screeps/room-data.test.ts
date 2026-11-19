import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { extractRooms, fetchRoomDirectory } from "./dashboard";
import { parseRoomObjectEntities, fetchRoomDetailSnapshot, mergeRoomDetailEvent } from "./room-detail";
import { extractObjectStore } from "./object-store";
import { aggregateRoomResources, summarizeRoomObjects } from "./room-insights";
import { buildRoomIntents, createConstructionSite, submitRoomIntent } from "./room-actions";
import type { RoomDetailSnapshot, RoomObjectSummary, ScreepsSession } from "./types";

const session: ScreepsSession = { baseUrl: "https://rooms.example", username: "Alice", userId: "alice-id", token: "fake-test-token", endpointMap: { profile: { id: "me", endpoint: "/api/auth/me" }, rooms: { id: "rooms", endpoint: "/api/user/rooms" } }, verifiedAt: "2026-11-17", probes: [] };
const object = (type: string, extra: Partial<RoomObjectSummary> = {}): RoomObjectSummary => ({ id: type, type, x: 10, y: 10, ...extra });
const snapshot = (objects: RoomObjectSummary[], shard = "main"): RoomDetailSnapshot => ({ fetchedAt: "2026-11-17T00:00:00Z", roomName: "W1N1", shard, objects, sources: [], minerals: [], creeps: [], structures: [] });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe("room data integrity", () => {
  it("keeps same-named rooms separate across official and private shards", () => {
    const rooms = extractRooms({ shards: { shard0: ["W1N1"], shard1: ["W1N1"], main: ["W1N1"], season: ["W2N2"] } });
    expect(rooms).toHaveLength(4);
    expect(rooms.filter((room) => room.name === "W1N1").map((room) => room.shard).sort()).toEqual(["main", "shard0", "shard1"]);
    expect(extractRooms({ ok: 1, rooms: { main: ["W1N1"], season: ["W1N1"] } }).map((room) => room.shard).sort()).toEqual(["main", "season"]);
  });

  it("counts modern and legacy inventory fields once and keeps an explicit zero", () => {
    expect(extractObjectStore({ store: { energy: 100, H: 50 }, resources: { energy: 100 }, energy: 100, mineralType: "H", mineralAmount: 50 })).toEqual({ energy: 100, H: 50 });
    expect(extractObjectStore({ store: { energy: 0 }, energy: 100, ghodium: 50 })).toEqual({ energy: 0, G: 50 });
  });

  it("excludes natural, carried and salvage resources from building stock", () => {
    const result = summarizeRoomObjects([
      object("storage", { store: { energy: 100, H: 20 }, energy: 100 }),
      object("source", { energy: 3000 }), object("mineral", { mineralAmount: 2000 }),
      object("creep", { store: { energy: 50 } }), object("ruin", { store: { energy: 200 } }),
      object("resource", { store: { energy: 500 } }), object("constructionSite", { progress: 10, progressTotal: 100 }),
    ]);
    expect(result.storedEnergy).toBe(100);
    expect(result.buildingCount).toBe(1);
    expect(result.resourceTotals).toEqual([{ resourceType: "energy", amount: 100 }, { resourceType: "H", amount: 20 }]);
    expect(result.constructionSiteCount).toBe(1);
  });

  it("excludes stale room snapshots from current resource totals", () => {
    const current = summarizeRoomObjects([object("storage", { store: { energy: 100, H: 20 } })]);
    const stale = summarizeRoomObjects([object("storage", { store: { energy: 900, H: 500 } })]);
    expect(aggregateRoomResources([
      { resourceTotals: current.resourceTotals },
      { resourceTotals: stale.resourceTotals, stale: true },
    ])).toEqual([
      { resourceType: "energy", amount: 100 },
      { resourceType: "H", amount: 20 },
    ]);
    expect(aggregateRoomResources([{ resourceTotals: stale.resourceTotals, stale: true }])).toEqual([]);
  });

  it("keeps same-ID objects distinct when their type or position differs", () => {
    const result = summarizeRoomObjects([
      object("road", { id: "shared", x: 1, y: 1 }),
      object("rampart", { id: "shared", x: 1, y: 1 }),
      object("rampart", { id: "shared", x: 2, y: 1 }),
    ]);
    expect(result.buildingCount).toBe(3);
    expect(result.buildingTypeCount).toBe(2);
  });

  it("preserves IDs, capacity and legacy lab inventory in full object parsing", () => {
    const result = parseRoomObjectEntities("W1N1", "main", [{ objects: {
      laboratory: { type: "lab", room: "W1N1", x: 3, y: 4, mineralType: "XGH2O", mineralAmount: 300, energy: 100, storeCapacityResource: { energy: 2000, XGH2O: 3000 }, user: "alice-id" },
      spawn: { type: "spawn", room: "W1N1", x: 5, y: 6, store: { energy: 200 }, energy: 200, storeCapacityResource: { energy: 300 }, user: "alice-id" },
    }, users: { "alice-id": { username: "Alice" } } }]);
    expect(result.shard).toBe("main");
    expect(result.objects.find((item) => item.id === "laboratory")?.store).toEqual({ XGH2O: 300, energy: 100 });
    expect(result.minerals).toHaveLength(0);
    expect(result.energyAvailable).toBe(200);
    expect(result.energyCapacity).toBe(300);
  });

  it("surfaces rejected room directory requests instead of fabricating an empty empire", async () => {
    vi.stubGlobal("window", { setTimeout });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })));
    await expect(fetchRoomDirectory(session)).rejects.toThrow("unauthorized");
  });

  it("never falls back to another shard after an explicit room request fails", async () => {
    vi.stubGlobal("window", { setTimeout });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "room unavailable" }), { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchRoomDetailSnapshot(session, "W1N1", "main", { requireObjects: true, includeTerrain: false })).rejects.toThrow("Room objects unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(new URL(url).searchParams.get("shard") ?? JSON.parse(String(init.body)).shard).toBe("main");
    }
  });

  it("merges realtime inventory deltas without losing other resources or buildings", () => {
    const current = snapshot([object("storage", { store: { energy: 100, H: 50 } }), object("tower", { energy: 200 })]);
    const next = mergeRoomDetailEvent(current, { gameTime: 5, objects: { storage: { store: { energy: 80, H: null } } } });
    expect(next?.objects).toHaveLength(2);
    expect(next?.objects.find((item) => item.id === "storage")?.store).toEqual({ energy: 80 });
    expect(next?.objects.find((item) => item.id === "tower")?.energy).toBe(200);
    expect(next?.gameTime).toBe(5);
    expect(current.objects[0].store).toEqual({ energy: 100, H: 50 });
  });

  it("applies explicit realtime deletions and accepts an empty full snapshot", () => {
    const current = snapshot([object("storage", { store: { energy: 100 } }), object("tower")]);
    expect(mergeRoomDetailEvent(current, { objects: { tower: null } })?.objects.map((item) => item.id)).toEqual(["storage"]);
    expect(mergeRoomDetailEvent(current, { objects: [] })?.objects).toEqual([]);
    expect(mergeRoomDetailEvent(current, { gameTime: 6 })?.objects).toHaveLength(2);
  });

  it("does not count duplicated nested object envelopes twice", () => {
    const spawn = { _id: "spawn", type: "spawn", x: 5, y: 6, store: { energy: 200 }, storeCapacityResource: { energy: 300 } };
    const result = parseRoomObjectEntities("W1N1", "main", [{ objects: [spawn], data: { objects: [spawn] } }]);
    expect(result.energyAvailable).toBe(200);
    expect(result.energyCapacity).toBe(300);
  });

  it("derives remaining creep lifetime from the server expiry tick", () => {
    const result = parseRoomObjectEntities("W1N1", "main", [{ gameTime: 1000, objects: [
      { _id: "creep", type: "creep", x: 10, y: 10, ageTime: 1250, name: "Worker" },
    ] }]);
    expect(result.objects[0].ttl).toBe(250);
    expect(result.creeps[0].ttl).toBe(250);
    const current = { ...snapshot(result.objects), gameTime: 1000, officialObjects: [
      { _id: "creep", type: "creep", x: 10, y: 10, ageTime: 1250, name: "Worker" },
    ] };
    expect(mergeRoomDetailEvent(current, { gameTime: 1010 })?.objects[0].ttl).toBe(240);
  });
});

describe("explicit room management", () => {
  it("targets owned objects only and preserves shard identity", () => {
    const own = object("rampart", { user: "alice-id", id: "rampart-own" });
    const foreign = object("rampart", { user: "bob-id", id: "rampart-foreign" });
    const plan = buildRoomIntents(session, [snapshot([own, foreign]), snapshot([own], "shard1")], "openRamparts");
    expect(plan).toHaveLength(2);
    expect(plan.map((item) => item.shard)).toEqual(["main", "shard1"]);
    expect(plan.every((item) => item.objectId === own.id && "isPublic" in item.intent && item.intent.isPublic)).toBe(true);
    expect(buildRoomIntents({ ...session, token: "" }, [snapshot([own])], "openRamparts")).toEqual([]);
    expect(buildRoomIntents(session, [snapshot([object("rampart", { user: "bob-id", owner: "Alice" })])], "openRamparts")).toEqual([]);
  });

  it("does not create attack-notification intents for creeps", () => {
    const creep = object("creep", { user: "alice-id", id: "owned-creep" });
    const spawn = object("spawn", { user: "alice-id", id: "owned-spawn" });
    const plan = buildRoomIntents(session, [snapshot([creep, spawn])], "enableNotifications");
    expect(plan.map((intent) => intent.objectId)).toEqual([spawn.id]);
    expect(plan[0]?.name).toBe("notifyWhenAttacked");
  });

  it("posts one structured intent and does not retry a rejected write", async () => {
    vi.stubGlobal("window", { setTimeout });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: 0, error: "not owner" })));
    vi.stubGlobal("fetch", fetcher);
    const plan = buildRoomIntents(session, [snapshot([object("rampart", { user: "alice-id" })])], "closeRamparts");
    await expect(submitRoomIntent(session, plan[0])).rejects.toThrow("not owner");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ room: "W1N1", shard: "main", _id: "rampart", name: "setPublic", intent: { isPublic: false } });
  });

  it("rejects invalid construction coordinates before making a write", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(createConstructionSite(session, { room: "W1N1", x: 50, y: 10, structureType: "road" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not repeat a native mutation in the browser when the bridge fails", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Native request interrupted"));
    const plan = buildRoomIntents(session, [snapshot([object("rampart", { user: "alice-id" })])], "closeRamparts");
    await expect(submitRoomIntent(session, plan[0])).rejects.toThrow("Native request interrupted");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("screeps_request", expect.any(Object));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
