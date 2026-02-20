import { screepsRequest } from "./request";
import type {
  QueryParams,
  RoomCreepSummary,
  RoomDetailSnapshot,
  RoomMineralSummary,
  RoomSourceSummary,
  RoomStructureSummary,
  ScreepsSession,
} from "./types";

const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/;

interface RoomOverviewRequest {
  endpoint: string;
  method: "GET" | "POST";
  query?: QueryParams;
  body?: unknown;
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
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
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

function parseRoomCore(
  roomName: string,
  mapStatsPayload: unknown,
  roomsPayload: unknown,
  overviewPayload: unknown
): {
  owner?: string;
  controllerLevel?: number;
  energyAvailable?: number;
  energyCapacity?: number;
} {
  const records: Record<string, unknown>[] = [];
  flattenRecords(mapStatsPayload, 0, records);
  flattenRecords(roomsPayload, 0, records);
  flattenRecords(overviewPayload, 0, records);

  let owner: string | undefined;
  let controllerLevel: number | undefined;
  let energyAvailable: number | undefined;
  let energyCapacity: number | undefined;

  for (const record of records) {
    const matchRoom =
      firstString([record.room, record.roomName, record.name, record._id]) ?? "";

    if (matchRoom && matchRoom.toUpperCase() !== roomName) {
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

function parseRoomEntities(
  roomName: string,
  payloads: unknown[]
): {
  sources: RoomSourceSummary[];
  minerals: RoomMineralSummary[];
  structures: RoomStructureSummary[];
  creeps: RoomCreepSummary[];
} {
  const records: Record<string, unknown>[] = [];
  for (const payload of payloads) {
    flattenRecords(payload, 0, records);
  }

  const sourceMap = new Map<string, RoomSourceSummary>();
  const mineralMap = new Map<string, RoomMineralSummary>();
  const structureMap = new Map<string, RoomStructureSummary>();
  const creepMap = new Map<string, RoomCreepSummary>();

  for (const record of records) {
    const matchRoom =
      firstString([record.room, record.roomName, record.name, record._id]) ?? roomName;
    if (matchRoom && matchRoom.toUpperCase() !== roomName) {
      continue;
    }

    const x = asNumber(record.x);
    const y = asNumber(record.y);
    if (x === undefined || y === undefined) {
      continue;
    }

    const objectType = firstString([record.type, record.structureType, record.objectType]);
    const objectName = firstString([record.name, record.creepName]);

    if (objectType === "source") {
      sourceMap.set(`${x}:${y}`, { x, y });
      continue;
    }

    if (objectType?.includes("mineral") || firstString([record.mineralType])) {
      mineralMap.set(`${x}:${y}`, {
        x,
        y,
        type: firstString([record.mineralType, objectType]),
      });
      continue;
    }

    if (objectType === "creep" || objectName) {
      const name = objectName ?? `creep-${x}-${y}`;
      creepMap.set(name, {
        name,
        role: firstString([record.role, asRecord(record.memory)?.role]),
        x,
        y,
        ttl: asNumber(record.ticksToLive),
      });
      continue;
    }

    if (objectType) {
      structureMap.set(`${objectType}:${x}:${y}`, {
        type: objectType,
        x,
        y,
        hits: asNumber(record.hits),
        hitsMax: asNumber(record.hitsMax),
      });
    }
  }

  return {
    sources: [...sourceMap.values()],
    minerals: [...mineralMap.values()],
    structures: [...structureMap.values()],
    creeps: [...creepMap.values()],
  };
}

async function tryRoomOverview(
  baseUrl: string,
  token: string,
  username: string,
  roomName: string
): Promise<unknown> {
  const requests: RoomOverviewRequest[] = [
    {
      endpoint: "/api/game/room-overview",
      method: "GET",
      query: { room: roomName, interval: 8, shard: "shard0" },
    },
    {
      endpoint: "/api/game/room-overview",
      method: "POST",
      body: { room: roomName, interval: 8, shard: "shard0" },
    },
    {
      endpoint: "/api/game/room-status",
      method: "GET",
      query: { room: roomName },
    },
  ];

  for (const request of requests) {
    try {
      const response = await screepsRequest({
        baseUrl,
        endpoint: request.endpoint,
        method: request.method,
        query: request.query,
        body: request.body,
        token,
        username,
      });

      if (response.ok) {
        return response.data;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function fetchRoomDetailSnapshot(
  session: ScreepsSession,
  roomInput: string
): Promise<RoomDetailSnapshot> {
  const roomName = normalizeRoomName(roomInput);

  const [terrainResponse, mapStatsResponse, overviewPayload, roomsPayload] = await Promise.all([
    screepsRequest({
      baseUrl: session.baseUrl,
      endpoint: "/api/game/room-terrain",
      method: "GET",
      query: { room: roomName, encoded: 1 },
      token: session.token,
      username: session.username,
    }).catch(() => undefined),
    screepsRequest({
      baseUrl: session.baseUrl,
      endpoint: "/api/game/map-stats",
      method: "POST",
      body: { rooms: [roomName], statName: "owner0" },
      token: session.token,
      username: session.username,
    }).catch(() => undefined),
    tryRoomOverview(session.baseUrl, session.token, session.username, roomName),
    session.endpointMap.rooms
      ? screepsRequest({
          baseUrl: session.baseUrl,
          endpoint: session.endpointMap.rooms.endpoint,
          method: session.endpointMap.rooms.method,
          query: session.endpointMap.rooms.query,
          body: session.endpointMap.rooms.body,
          token: session.token,
          username: session.username,
        }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const terrainPayload = terrainResponse?.ok ? terrainResponse.data : undefined;
  const mapStatsPayload = mapStatsResponse?.ok ? mapStatsResponse.data : undefined;
  const roomsData = roomsPayload?.ok ? roomsPayload.data : undefined;

  const core = parseRoomCore(roomName, mapStatsPayload, roomsData, overviewPayload);
  const entities = parseRoomEntities(roomName, [mapStatsPayload, roomsData, overviewPayload]);

  return {
    fetchedAt: new Date().toISOString(),
    roomName,
    owner: core.owner,
    controllerLevel: core.controllerLevel,
    energyAvailable: core.energyAvailable,
    energyCapacity: core.energyCapacity,
    terrainEncoded: extractTerrain(terrainPayload),
    sources: entities.sources,
    minerals: entities.minerals,
    structures: entities.structures,
    creeps: entities.creeps,
  };
}
