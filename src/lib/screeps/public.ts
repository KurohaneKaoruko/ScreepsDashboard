import { normalizeBaseUrl, screepsRequest } from "./request";
import type {
  PublicLeaderboardEntry,
  PublicMapSummary,
  PublicRoomStat,
  PublicSnapshot,
  ScreepsRequest,
  ScreepsResponse,
} from "./types";

const DEFAULT_TERRAIN_ROOM = "W0N0";
const SAMPLE_ROOMS = ["W0N0", "W1N0", "W0N1", "W1N1"];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
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

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0") {
      return false;
    }
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

function getMessage(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }
  return firstString([record.error, record.message, record.text]);
}

async function safeRequest(
  id: string,
  request: ScreepsRequest
): Promise<{ id: string; response?: ScreepsResponse; error?: string }> {
  try {
    const response = await screepsRequest(request);
    if (!response.ok) {
      return {
        id,
        response,
        error: getMessage(response.data) ?? `HTTP ${response.status}`,
      };
    }
    return { id, response };
  } catch (error) {
    return {
      id,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

function flattenRecords(payload: unknown, depth: number, sink: Record<string, unknown>[]): void {
  if (depth > 5 || payload === null || payload === undefined) {
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

function extractLeaderboardEntries(payload: unknown): PublicLeaderboardEntry[] {
  const records: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, records);

  const entries: PublicLeaderboardEntry[] = [];
  for (const record of records) {
    const username = firstString([
      record.username,
      asRecord(record.user)?.username,
      record.user,
      record.name,
    ]);
    if (!username) {
      continue;
    }

    const rank = firstNumber([record.rank, record.place, record.index]);
    const score = firstNumber([record.score, record.power, record.gcl, record.value]);
    entries.push({ username, rank, score });
    if (entries.length >= 10) {
      break;
    }
  }

  return entries;
}

function toRoomName(value: unknown): string | undefined {
  const room = asString(value);
  if (!room) {
    return undefined;
  }
  return /^[WE]\d+[NS]\d+$/.test(room) ? room : undefined;
}

function extractMapStats(payload: unknown): PublicRoomStat[] {
  const records: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, records);

  const roomMap = new Map<string, PublicRoomStat>();

  for (const record of records) {
    const room = toRoomName(record.room) ?? toRoomName(record.roomName) ?? toRoomName(record.name);
    if (!room) {
      continue;
    }

    const previous = roomMap.get(room);
    const owner = firstString([record.owner, asRecord(record.controller)?.owner, previous?.owner]);
    const level = firstNumber([record.level, asRecord(record.controller)?.level, previous?.level]);
    const novice = asBoolean(record.novice) ?? previous?.novice;
    const respawnArea = asBoolean(record.respawnArea) ?? previous?.respawnArea;

    roomMap.set(room, {
      room,
      owner,
      level,
      novice,
      respawnArea,
    });
  }

  return [...roomMap.values()].slice(0, 12);
}

function buildMapSummary(
  terrainPayload: unknown,
  mapStatsPayload: unknown,
  sources: string[]
): PublicMapSummary {
  const terrainRecord = asRecord(terrainPayload) ?? {};
  const encodedTerrain = firstString([
    terrainRecord.terrain,
    terrainRecord.encodedTerrain,
    asRecord(terrainRecord.roomTerrain)?.terrain,
  ]);
  const terrainRoom =
    firstString([terrainRecord.room, terrainRecord.roomName]) ?? DEFAULT_TERRAIN_ROOM;
  const roomStats = extractMapStats(mapStatsPayload);

  return {
    terrainRoom,
    terrainAvailable: Boolean(encodedTerrain),
    encodedTerrain,
    roomStats,
    sources,
  };
}

export async function fetchPublicSnapshot(rawBaseUrl: string): Promise<PublicSnapshot> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const statuses: Record<string, number> = {};
  const raw: Record<string, unknown> = {};
  const errors: string[] = [];

  const [leaderboardList, leaderboardSeasons, mapStats, terrain] = await Promise.all([
    safeRequest("leaderboard_list", {
      baseUrl,
      endpoint: "/api/leaderboard/list",
      method: "GET",
      query: { mode: "world", limit: 10, offset: 0 },
    }),
    safeRequest("leaderboard_seasons", {
      baseUrl,
      endpoint: "/api/leaderboard/seasons",
      method: "GET",
    }),
    safeRequest("map_stats", {
      baseUrl,
      endpoint: "/api/game/map-stats",
      method: "POST",
      body: { rooms: SAMPLE_ROOMS, statName: "owner0" },
    }),
    safeRequest("room_terrain", {
      baseUrl,
      endpoint: "/api/game/room-terrain",
      method: "GET",
      query: { room: DEFAULT_TERRAIN_ROOM, encoded: 1 },
    }),
  ]);

  const results = [leaderboardList, leaderboardSeasons, mapStats, terrain];
  for (const result of results) {
    statuses[result.id] = result.response?.status ?? 0;
    if (result.response) {
      raw[result.id] = result.response.data;
    }
    if (result.error) {
      errors.push(`${result.id}: ${result.error}`);
    }
  }

  const leaderboardPayload =
    leaderboardList.response?.data ?? leaderboardSeasons.response?.data ?? {};
  const leaderboardEntries = extractLeaderboardEntries(leaderboardPayload);
  const season = firstString([
    asRecord(leaderboardList.response?.data)?.season,
    asRecord(leaderboardSeasons.response?.data)?.season,
    asArray(leaderboardSeasons.response?.data)[0],
  ]);

  const mapPayload = mapStats.response?.data ?? {};
  const terrainPayload = terrain.response?.data ?? {};

  return {
    fetchedAt: new Date().toISOString(),
    baseUrl,
    leaderboard:
      leaderboardEntries.length > 0
        ? {
            source: leaderboardList.response ? "leaderboard/list" : "leaderboard/seasons",
            season,
            entries: leaderboardEntries,
          }
        : undefined,
    map: buildMapSummary(terrainPayload, mapPayload, [
      mapStats.response ? "game/map-stats" : "game/map-stats (unavailable)",
      terrain.response ? "game/room-terrain" : "game/room-terrain (unavailable)",
    ]),
    statuses,
    errors,
    raw,
  };
}
