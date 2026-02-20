import { screepsBatchRequest, screepsRequest } from "./request";
import { getTerrainFromCache, setTerrainToCache } from "./terrain-cache";
import type {
  QueryParams,
  RoomCreepSummary,
  RoomDetailSnapshot,
  RoomMineralSummary,
  RoomObjectSummary,
  RoomSourceSummary,
  RoomStructureSummary,
  ScreepsResponse,
  ScreepsSession,
} from "./types";

const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/;
const ROOM_NAME_EXTRACT_PATTERN = /[WE]\d+[NS]\d+/i;
const SHARD_PATTERN = /^shard\d+$/i;

const STRUCTURE_TYPES = new Set([
  "constructedWall",
  "container",
  "controller",
  "extension",
  "extractor",
  "factory",
  "invaderCore",
  "keeperLair",
  "lab",
  "link",
  "nuker",
  "observer",
  "portal",
  "powerBank",
  "powerSpawn",
  "rampart",
  "road",
  "spawn",
  "storage",
  "terminal",
  "tower",
  "wall",
]);

interface RoomOverviewRequest {
  endpoint: string;
  method: "GET" | "POST";
  query?: QueryParams;
  body?: unknown;
}

interface RoomCoreSummary {
  owner?: string;
  controllerLevel?: number;
  energyAvailable?: number;
  energyCapacity?: number;
}

interface ParsedEntities {
  shard?: string;
  owner?: string;
  controllerLevel?: number;
  energyAvailable?: number;
  energyCapacity?: number;
  sources: RoomSourceSummary[];
  minerals: RoomMineralSummary[];
  structures: RoomStructureSummary[];
  creeps: RoomCreepSummary[];
  objects: RoomObjectSummary[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeRoomCandidate(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) {
    return undefined;
  }

  const match = text.toUpperCase().match(ROOM_NAME_EXTRACT_PATTERN);
  return match?.[0];
}

function normalizeShard(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return SHARD_PATTERN.test(normalized) ? normalized : undefined;
}

function extractRecordRoomName(record: Record<string, unknown>): string | undefined {
  return normalizeRoomCandidate(
    firstString([
      record.room,
      record.roomName,
      record.room_id,
      record.roomId,
      record._id,
      record.name,
    ])
  );
}

function flattenRecords(payload: unknown, depth: number, sink: Record<string, unknown>[]): void {
  if (depth > 6 || payload === null || payload === undefined) {
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      flattenRecords(item, depth + 1, sink);
    }
    return;
  }

  const record = asRecord(payload);
  if (!record) {
    return;
  }

  sink.push(record);
  for (const value of Object.values(record)) {
    flattenRecords(value, depth + 1, sink);
  }
}

function extractTerrainString(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const itemDirect = asString(item);
      if (itemDirect) {
        return itemDirect;
      }

      const itemRecord = asRecord(item) ?? {};
      const nested = firstString([
        itemRecord.terrain,
        itemRecord.encodedTerrain,
        asRecord(itemRecord.roomTerrain)?.terrain,
      ]);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const record = asRecord(value) ?? {};
  return firstString([
    record.terrain,
    record.encodedTerrain,
    asRecord(record.roomTerrain)?.terrain,
  ]);
}

function extractTerrain(payload: unknown): string | undefined {
  const root = asRecord(payload) ?? {};
  return (
    extractTerrainString(root.terrain) ??
    extractTerrainString(root.encodedTerrain) ??
    extractTerrainString(root.roomTerrain)
  );
}

function normalizeRoomName(roomName: string): string {
  const normalized = roomName.trim().toUpperCase();
  if (!ROOM_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid room name: ${roomName}`);
  }
  return normalized;
}

function isStructureType(type: string): boolean {
  return STRUCTURE_TYPES.has(type);
}

function resolveOwnerName(
  record: Record<string, unknown>,
  userDirectory: ReadonlyMap<string, string>
): string | undefined {
  const ownerRecord = asRecord(record.owner) ?? {};
  const reservation = asRecord(record.reservation) ?? {};
  const sign = asRecord(record.sign) ?? {};

  const ownerCandidate = firstString([
    ownerRecord.username,
    ownerRecord.name,
    ownerRecord.user,
    record.user,
    record.owner,
    reservation.username,
    reservation.user,
    sign.username,
    sign.user,
  ]);
  if (!ownerCandidate) {
    return undefined;
  }

  return userDirectory.get(ownerCandidate) ?? ownerCandidate;
}

function collectUserDirectory(value: unknown, sink: Map<string, string>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUserDirectory(item, sink);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const directId = firstString([record._id, record.id, record.userId, record.user]);
  const directName = firstString([record.username, record.name]);
  if (directId && directName) {
    sink.set(directId, directName);
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    const nestedRecord = asRecord(nestedValue);
    if (!nestedRecord) {
      continue;
    }

    const nestedId =
      firstString([nestedRecord._id, nestedRecord.id, nestedRecord.userId]) ?? key;
    const nestedName = firstString([nestedRecord.username, nestedRecord.name]);
    if (nestedId && nestedName) {
      sink.set(nestedId, nestedName);
    }
  }
}

function buildUserDirectory(payloads: unknown[]): Map<string, string> {
  const userDirectory = new Map<string, string>();

  for (const payload of payloads) {
    if (!payload) {
      continue;
    }

    const root = asRecord(payload) ?? {};
    collectUserDirectory(root.users, userDirectory);
    collectUserDirectory(asRecord(root.data)?.users, userDirectory);
    collectUserDirectory(asRecord(root.result)?.users, userDirectory);

    const records: Record<string, unknown>[] = [];
    flattenRecords(payload, 0, records);
    for (const record of records) {
      const id = firstString([record._id, record.id, record.userId, record.user]);
      const username = firstString([record.username, record.name]);
      if (id && username) {
        userDirectory.set(id, username);
      }
    }
  }

  return userDirectory;
}

function collectObjectRecordsFromValue(
  value: unknown,
  sink: Record<string, unknown>[]
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      if (record) {
        sink.push(record);
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const directX = asNumber(record.x);
  const directY = asNumber(record.y);
  if (directX !== undefined && directY !== undefined) {
    sink.push(record);
    return;
  }

  for (const nested of Object.values(record)) {
    const nestedRecord = asRecord(nested);
    if (!nestedRecord) {
      continue;
    }

    const nestedX = asNumber(nestedRecord.x);
    const nestedY = asNumber(nestedRecord.y);
    if (nestedX !== undefined && nestedY !== undefined) {
      sink.push(nestedRecord);
    }
  }
}

function extractRoomObjectRecords(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload) ?? {};
  const objectCandidates = [
    root.objects,
    root.roomObjects,
    root.data,
    root.result,
    root.message,
    asRecord(root.data)?.objects,
    asRecord(root.result)?.objects,
    asRecord(root.message)?.objects,
    asRecord(root.data)?.roomObjects,
    asRecord(root.result)?.roomObjects,
    asRecord(root.message)?.roomObjects,
  ];

  const objectRecords: Record<string, unknown>[] = [];
  for (const candidate of objectCandidates) {
    collectObjectRecordsFromValue(candidate, objectRecords);
  }

  if (objectRecords.length > 0) {
    return objectRecords;
  }

  const fallbackRecords: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, fallbackRecords);
  return fallbackRecords.filter((record) => {
    const x = asNumber(record.x);
    const y = asNumber(record.y);
    return x !== undefined && y !== undefined;
  });
}

function resolveObjectType(record: Record<string, unknown>): string | undefined {
  const directType = firstString([record.type, record.objectType, record.structureType]);
  if (directType) {
    return directType;
  }

  if (firstString([record.mineralType])) {
    return "mineral";
  }

  if (
    firstString([record.name, record.creepName]) &&
    firstNumber([record.ticksToLive, record.ttl]) !== undefined
  ) {
    return "creep";
  }

  return undefined;
}

function parseFallbackEntities(roomName: string, payloads: unknown[]): ParsedEntities {
  const records: Record<string, unknown>[] = [];
  for (const payload of payloads) {
    flattenRecords(payload, 0, records);
  }

  const sourceMap = new Map<string, RoomSourceSummary>();
  const mineralMap = new Map<string, RoomMineralSummary>();
  const structureMap = new Map<string, RoomStructureSummary>();
  const creepMap = new Map<string, RoomCreepSummary>();
  const objectMap = new Map<string, RoomObjectSummary>();

  let owner: string | undefined;
  let controllerLevel: number | undefined;
  let energyAvailable: number | undefined;
  let energyCapacity: number | undefined;
  let shard: string | undefined;

  for (const record of records) {
    const recordRoom = extractRecordRoomName(record);
    if (recordRoom && recordRoom !== roomName) {
      continue;
    }

    const detectedShard = normalizeShard(
      firstString([record.shard, record.worldShard, record.mapShard])
    );
    if (!shard && detectedShard) {
      shard = detectedShard;
    }

    const x = asNumber(record.x);
    const y = asNumber(record.y);
    if (x === undefined || y === undefined) {
      continue;
    }

    const type = resolveObjectType(record);
    if (!type) {
      continue;
    }

    const objectId = firstString([record._id, record.id, record.name]) ?? `${type}:${x}:${y}`;
    const resolvedOwner = firstString([record.owner, record.user]);
    const resolvedName = firstString([record.name, record.creepName]);
    const hits = asNumber(record.hits);
    const hitsMax = asNumber(record.hitsMax);
    const ttl = firstNumber([record.ticksToLive, record.ttl]);

    objectMap.set(`${objectId}:${type}:${x}:${y}`, {
      id: objectId,
      type,
      x,
      y,
      owner: resolvedOwner,
      name: resolvedName,
      hits,
      hitsMax,
      ttl,
    });

    if (type === "source") {
      sourceMap.set(`${x}:${y}`, { x, y });
      continue;
    }

    if (type === "mineral" || firstString([record.mineralType])) {
      mineralMap.set(`${x}:${y}`, {
        x,
        y,
        type: firstString([record.mineralType, type]),
      });
      continue;
    }

    if (type === "controller") {
      owner = firstString([owner, record.owner, record.user]);
      controllerLevel = firstNumber([controllerLevel, record.level]);
      continue;
    }

    if (type === "creep" || type === "powerCreep") {
      const creepName = resolvedName ?? `${type}-${x}-${y}`;
      creepMap.set(creepName, {
        name: creepName,
        role: firstString([record.role, asRecord(record.memory)?.role]),
        x,
        y,
        ttl,
      });
      continue;
    }

    if (isStructureType(type)) {
      const summary: RoomStructureSummary = {
        type,
        x,
        y,
        hits,
        hitsMax,
      };
      structureMap.set(`${type}:${x}:${y}`, summary);

      if (type === "spawn" || type === "extension") {
        const store = asRecord(record.store) ?? {};
        const storeCapacity = asRecord(record.storeCapacity) ?? {};
        const storeCapacityResource = asRecord(record.storeCapacityResource) ?? {};

        const used = firstNumber([record.energy, store.energy]);
        const capacity = firstNumber([
          record.energyCapacity,
          storeCapacityResource.energy,
          storeCapacity.energy,
          record.storeCapacity,
        ]);

        if (used !== undefined) {
          energyAvailable = (energyAvailable ?? 0) + used;
        }
        if (capacity !== undefined) {
          energyCapacity = (energyCapacity ?? 0) + capacity;
        }
      }
    }
  }

  return {
    shard,
    owner,
    controllerLevel,
    energyAvailable,
    energyCapacity,
    sources: [...sourceMap.values()],
    minerals: [...mineralMap.values()],
    structures: [...structureMap.values()],
    creeps: [...creepMap.values()],
    objects: [...objectMap.values()],
  };
}

function parseRoomObjectEntities(
  roomName: string,
  shardHint: string | undefined,
  payloads: unknown[]
): ParsedEntities {
  const userDirectory = buildUserDirectory(payloads);

  const sourceMap = new Map<string, RoomSourceSummary>();
  const mineralMap = new Map<string, RoomMineralSummary>();
  const structureMap = new Map<string, RoomStructureSummary>();
  const creepMap = new Map<string, RoomCreepSummary>();
  const objectMap = new Map<string, RoomObjectSummary>();

  let owner: string | undefined;
  let controllerLevel: number | undefined;
  let energyAvailable: number | undefined;
  let energyCapacity: number | undefined;
  let shard = shardHint;

  for (const payload of payloads) {
    const objectRecords = extractRoomObjectRecords(payload);
    for (const record of objectRecords) {
      const recordRoom = extractRecordRoomName(record);
      if (recordRoom && recordRoom !== roomName) {
        continue;
      }

      const detectedShard = normalizeShard(
        firstString([record.shard, record.worldShard, record.mapShard])
      );
      if (!shard && detectedShard) {
        shard = detectedShard;
      }

      const x = asNumber(record.x);
      const y = asNumber(record.y);
      if (x === undefined || y === undefined || x < 0 || x > 49 || y < 0 || y > 49) {
        continue;
      }

      const type = resolveObjectType(record);
      if (!type) {
        continue;
      }

      const objectId =
        firstString([record._id, record.id]) ?? `${type}:${x}:${y}:${objectMap.size + 1}`;
      const resolvedOwner = resolveOwnerName(record, userDirectory);
      const resolvedName = firstString([record.name, record.creepName]);
      const hits = asNumber(record.hits);
      const hitsMax = asNumber(record.hitsMax);
      const ttl = firstNumber([record.ticksToLive, record.ttl]);

      objectMap.set(`${objectId}:${type}:${x}:${y}`, {
        id: objectId,
        type,
        x,
        y,
        owner: resolvedOwner,
        name: resolvedName,
        hits,
        hitsMax,
        ttl,
      });

      if (type === "source") {
        sourceMap.set(`${x}:${y}`, { x, y });
        continue;
      }

      if (type === "mineral" || firstString([record.mineralType])) {
        mineralMap.set(`${x}:${y}`, {
          x,
          y,
          type: firstString([record.mineralType, type]),
        });
        continue;
      }

      if (type === "controller") {
        owner = firstString([owner, resolvedOwner]);
        controllerLevel = firstNumber([controllerLevel, record.level]);
        continue;
      }

      if (type === "creep" || type === "powerCreep") {
        const creepName = resolvedName ?? `${type}-${x}-${y}`;
        creepMap.set(creepName, {
          name: creepName,
          role: firstString([record.role, asRecord(record.memory)?.role]),
          x,
          y,
          ttl,
        });
        continue;
      }

      if (isStructureType(type)) {
        structureMap.set(`${type}:${x}:${y}`, {
          type,
          x,
          y,
          hits,
          hitsMax,
        });

        if (type === "spawn" || type === "extension") {
          const store = asRecord(record.store) ?? {};
          const storeCapacity = asRecord(record.storeCapacity) ?? {};
          const storeCapacityResource = asRecord(record.storeCapacityResource) ?? {};

          const used = firstNumber([record.energy, store.energy]);
          const capacity = firstNumber([
            record.energyCapacity,
            storeCapacityResource.energy,
            storeCapacity.energy,
            record.storeCapacity,
          ]);

          if (used !== undefined) {
            energyAvailable = (energyAvailable ?? 0) + used;
          }
          if (capacity !== undefined) {
            energyCapacity = (energyCapacity ?? 0) + capacity;
          }
        }
      }
    }
  }

  return {
    shard,
    owner,
    controllerLevel,
    energyAvailable,
    energyCapacity,
    sources: [...sourceMap.values()],
    minerals: [...mineralMap.values()],
    structures: [...structureMap.values()],
    creeps: [...creepMap.values()],
    objects: [...objectMap.values()],
  };
}

function parseRoomCore(roomName: string, payloads: unknown[]): RoomCoreSummary {
  const records: Record<string, unknown>[] = [];
  for (const payload of payloads) {
    flattenRecords(payload, 0, records);
  }

  let owner: string | undefined;
  let controllerLevel: number | undefined;
  let energyAvailable: number | undefined;
  let energyCapacity: number | undefined;

  for (const record of records) {
    const matchRoom = extractRecordRoomName(record);
    if (matchRoom && matchRoom !== roomName) {
      continue;
    }

    const controller = asRecord(record.controller) ?? {};

    owner = firstString([owner, record.owner, controller.owner, controller.user]);
    controllerLevel = firstNumber([controllerLevel, record.level, controller.level]);
    energyAvailable = firstNumber([energyAvailable, record.energyAvailable, record.energy]);
    energyCapacity = firstNumber([
      energyCapacity,
      record.energyCapacityAvailable,
      record.energyCapacity,
    ]);
  }

  return {
    owner,
    controllerLevel,
    energyAvailable,
    energyCapacity,
  };
}

function mergeByKey<T>(
  primary: T[],
  secondary: T[],
  keyOf: (value: T) => string
): T[] {
  const merged = new Map<string, T>();

  for (const item of secondary) {
    merged.set(keyOf(item), item);
  }

  for (const item of primary) {
    merged.set(keyOf(item), item);
  }

  return [...merged.values()];
}

function toFallbackObjects(entities: ParsedEntities): RoomObjectSummary[] {
  const structureObjects = entities.structures.map((item) => ({
    id: `structure:${item.type}:${item.x}:${item.y}`,
    type: item.type,
    x: item.x,
    y: item.y,
    hits: item.hits,
    hitsMax: item.hitsMax,
  }));
  const creepObjects = entities.creeps.map((item) => ({
    id: `creep:${item.name}`,
    type: "creep",
    x: item.x,
    y: item.y,
    name: item.name,
    ttl: item.ttl,
  }));
  const sourceObjects = entities.sources.map((item) => ({
    id: `source:${item.x}:${item.y}`,
    type: "source",
    x: item.x,
    y: item.y,
  }));
  const mineralObjects = entities.minerals.map((item) => ({
    id: `mineral:${item.type ?? "unknown"}:${item.x}:${item.y}`,
    type: "mineral",
    x: item.x,
    y: item.y,
    name: item.type,
  }));

  return [...structureObjects, ...creepObjects, ...sourceObjects, ...mineralObjects];
}

function buildTerrainQueries(roomName: string, shard?: string): QueryParams[] {
  const queries: QueryParams[] = [];

  if (shard) {
    queries.push({ room: roomName, encoded: 1, shard });
  }
  queries.push({ room: roomName, encoded: 1 });
  if (!shard || shard !== "shard0") {
    queries.push({ room: roomName, encoded: 1, shard: "shard0" });
  }

  return queries;
}

async function requestCandidates(
  baseUrl: string,
  token: string,
  username: string,
  requests: RoomOverviewRequest[],
  maxConcurrency = 6
): Promise<ScreepsResponse[]> {
  if (requests.length === 0) {
    return [];
  }

  try {
    return await screepsBatchRequest(
      requests.map((request) => ({
        baseUrl,
        endpoint: request.endpoint,
        method: request.method,
        query: request.query,
        body: request.body,
        token,
        username,
      })),
      { maxConcurrency: Math.min(maxConcurrency, requests.length) }
    );
  } catch {
    return [];
  }
}

async function tryTerrain(
  baseUrl: string,
  token: string,
  username: string,
  roomName: string,
  shard?: string
): Promise<unknown> {
  const cachedTerrain = getTerrainFromCache(baseUrl, roomName, shard);
  if (cachedTerrain) {
    return { terrain: cachedTerrain };
  }

  const requests: RoomOverviewRequest[] = buildTerrainQueries(roomName, shard).map((query) => ({
    endpoint: "/api/game/room-terrain",
    method: "GET",
    query,
  }));
  const responses = await requestCandidates(baseUrl, token, username, requests, 3);

  let firstSuccessfulPayload: unknown;
  for (const response of responses) {
    if (!response.ok) {
      continue;
    }

    if (firstSuccessfulPayload === undefined) {
      firstSuccessfulPayload = response.data;
    }

    const terrain = extractTerrain(response.data);
    if (terrain) {
      setTerrainToCache(baseUrl, roomName, terrain, shard);
      return { terrain };
    }
  }

  return firstSuccessfulPayload;
}

async function tryMapStats(
  baseUrl: string,
  token: string,
  username: string,
  roomName: string,
  shard?: string
): Promise<unknown> {
  const bodies: Array<{ rooms: string[]; statName: string; shard?: string }> = [];
  if (shard) {
    bodies.push({ rooms: [roomName], statName: "owner0", shard });
  }
  bodies.push({ rooms: [roomName], statName: "owner0" });
  if (!shard || shard !== "shard0") {
    bodies.push({ rooms: [roomName], statName: "owner0", shard: "shard0" });
  }

  const responses = await requestCandidates(
    baseUrl,
    token,
    username,
    bodies.map((body) => ({
      endpoint: "/api/game/map-stats",
      method: "POST",
      body,
    })),
    3
  );

  for (const response of responses) {
    if (response.ok) {
      return response.data;
    }
  }

  return undefined;
}

function buildRoomOverviewRequests(roomName: string, shard?: string): RoomOverviewRequest[] {
  const requests: RoomOverviewRequest[] = [];

  if (shard) {
    requests.push({
      endpoint: "/api/game/room-overview",
      method: "GET",
      query: { room: roomName, interval: 8, shard },
    });
    requests.push({
      endpoint: "/api/game/room-overview",
      method: "POST",
      body: { room: roomName, interval: 8, shard },
    });
  }

  requests.push({
    endpoint: "/api/game/room-overview",
    method: "GET",
    query: { room: roomName, interval: 8 },
  });
  requests.push({
    endpoint: "/api/game/room-overview",
    method: "POST",
    body: { room: roomName, interval: 8 },
  });
  requests.push({
    endpoint: "/api/game/room-status",
    method: "GET",
    query: { room: roomName },
  });

  if (!shard || shard !== "shard0") {
    requests.push({
      endpoint: "/api/game/room-overview",
      method: "GET",
      query: { room: roomName, interval: 8, shard: "shard0" },
    });
    requests.push({
      endpoint: "/api/game/room-overview",
      method: "POST",
      body: { room: roomName, interval: 8, shard: "shard0" },
    });
  }

  return requests;
}

async function tryRoomOverview(
  baseUrl: string,
  token: string,
  username: string,
  roomName: string,
  shard?: string
): Promise<unknown> {
  const requests = buildRoomOverviewRequests(roomName, shard);
  const responses = await requestCandidates(baseUrl, token, username, requests, 6);

  for (const response of responses) {
    if (response.ok) {
      return response.data;
    }
  }

  return undefined;
}

function buildRoomObjectsRequests(
  roomName: string,
  shard?: string
): RoomOverviewRequest[] {
  const requests: RoomOverviewRequest[] = [];

  if (shard) {
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "GET",
      query: { room: roomName, shard },
    });
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "POST",
      body: { room: roomName, shard },
    });
  }

  requests.push({
    endpoint: "/api/game/room-objects",
    method: "GET",
    query: { room: roomName },
  });
  requests.push({
    endpoint: "/api/game/room-objects",
    method: "POST",
    body: { room: roomName },
  });

  if (!shard || shard !== "shard0") {
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "GET",
      query: { room: roomName, shard: "shard0" },
    });
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "POST",
      body: { room: roomName, shard: "shard0" },
    });
  }

  return requests;
}

async function tryRoomObjects(
  baseUrl: string,
  token: string,
  username: string,
  roomName: string,
  shard?: string
): Promise<unknown> {
  const requests = buildRoomObjectsRequests(roomName, shard);
  const responses = await requestCandidates(baseUrl, token, username, requests, 6);

  for (const response of responses) {
    if (!response.ok) {
      continue;
    }

    const records = extractRoomObjectRecords(response.data);
    if (records.length > 0) {
      return response.data;
    }
  }

  return undefined;
}

async function tryUserRooms(session: ScreepsSession): Promise<unknown> {
  if (!session.endpointMap.rooms) {
    return undefined;
  }

  try {
    const response = await screepsRequest({
      baseUrl: session.baseUrl,
      endpoint: session.endpointMap.rooms.endpoint,
      method: session.endpointMap.rooms.method,
      query: session.endpointMap.rooms.query,
      body: session.endpointMap.rooms.body,
      token: session.token,
      username: session.username,
    });
    return response.ok ? response.data : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchRoomDetailSnapshot(
  session: ScreepsSession,
  roomInput: string,
  shardInput?: string
): Promise<RoomDetailSnapshot> {
  const roomName = normalizeRoomName(roomInput);
  const shard = normalizeShard(shardInput);

  const [terrainPayload, mapStatsPayload, overviewPayload, roomObjectsPayload, roomsPayload] =
    await Promise.all([
      tryTerrain(session.baseUrl, session.token, session.username, roomName, shard),
      tryMapStats(session.baseUrl, session.token, session.username, roomName, shard),
      tryRoomOverview(session.baseUrl, session.token, session.username, roomName, shard),
      tryRoomObjects(session.baseUrl, session.token, session.username, roomName, shard),
      tryUserRooms(session),
    ]);

  const core = parseRoomCore(roomName, [
    mapStatsPayload,
    roomsPayload,
    overviewPayload,
    roomObjectsPayload,
  ]);

  const parsedRoomObjects = parseRoomObjectEntities(roomName, shard, [roomObjectsPayload]);
  const fallbackEntities = parseFallbackEntities(roomName, [
    mapStatsPayload,
    roomsPayload,
    overviewPayload,
  ]);

  const sources = mergeByKey(
    parsedRoomObjects.sources,
    fallbackEntities.sources,
    (item) => `${item.x}:${item.y}`
  );
  const minerals = mergeByKey(
    parsedRoomObjects.minerals,
    fallbackEntities.minerals,
    (item) => `${item.type ?? "unknown"}:${item.x}:${item.y}`
  );
  const structures = mergeByKey(
    parsedRoomObjects.structures,
    fallbackEntities.structures,
    (item) => `${item.type}:${item.x}:${item.y}`
  );
  const creeps = mergeByKey(parsedRoomObjects.creeps, fallbackEntities.creeps, (item) => item.name);
  const fallbackObjects = toFallbackObjects({
    ...fallbackEntities,
    objects: [],
  });
  const objects = mergeByKey(parsedRoomObjects.objects, fallbackObjects, (item) => item.id);

  const terrainEncoded = extractTerrain(terrainPayload);
  if (terrainEncoded) {
    setTerrainToCache(session.baseUrl, roomName, terrainEncoded, shard);
  }

  return {
    fetchedAt: new Date().toISOString(),
    roomName,
    shard: parsedRoomObjects.shard ?? fallbackEntities.shard ?? shard,
    owner: parsedRoomObjects.owner ?? fallbackEntities.owner ?? core.owner,
    controllerLevel:
      parsedRoomObjects.controllerLevel ?? fallbackEntities.controllerLevel ?? core.controllerLevel,
    energyAvailable:
      parsedRoomObjects.energyAvailable ?? fallbackEntities.energyAvailable ?? core.energyAvailable,
    energyCapacity:
      parsedRoomObjects.energyCapacity ?? fallbackEntities.energyCapacity ?? core.energyCapacity,
    terrainEncoded,
    sources,
    minerals,
    structures,
    creeps,
    objects,
  };
}
