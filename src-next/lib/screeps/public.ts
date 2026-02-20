import { normalizeBaseUrl, screepsBatchRequest } from "./request";
import type {
  PublicLeaderboardEntry,
  PublicMapSummary,
  PublicRoomStat,
  PublicSnapshot,
  ScreepsRequest,
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

function extractMetricRecord(record: Record<string, unknown>): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(record)) {
    const numeric = asNumber(value);
    if (numeric !== undefined) {
      metrics[key] = numeric;
    }
  }
  return metrics;
}

function collectLeaderboardDimensions(entries: PublicLeaderboardEntry[]): string[] {
  const preferred = ["score", "gcl", "power", "cpu", "pixels"];
  const dimensionSet = new Set<string>();
  for (const entry of entries) {
    for (const key of Object.keys(entry.metrics)) {
      dimensionSet.add(key);
    }
  }

  const dimensions = [...dimensionSet].sort((left, right) => left.localeCompare(right));
  const ordered: string[] = [];

  for (const key of preferred) {
    if (dimensionSet.has(key)) {
      ordered.push(key);
    }
  }

  for (const key of dimensions) {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered;
}

function extractLeaderboard(payload: unknown): { entries: PublicLeaderboardEntry[]; dimensions: string[] } {
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
    const metrics = extractMetricRecord(record);
    if (score !== undefined) {
      metrics.score = score;
    }

    entries.push({ username, rank, score, metrics });
    if (entries.length >= 12) {
      break;
    }
  }

  return {
    entries,
    dimensions: collectLeaderboardDimensions(entries),
  };
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

  return [...roomMap.values()].slice(0, 20);
}

function buildMapSummary(
  terrainPayload: unknown,
  mapStatsPayload: unknown
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
  };
}

export async function fetchPublicSnapshot(rawBaseUrl: string): Promise<PublicSnapshot> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  const requests: ScreepsRequest[] = [
    {
      baseUrl,
      endpoint: "/api/leaderboard/list",
      method: "GET",
      query: { mode: "world", limit: 12, offset: 0 },
    },
    {
      baseUrl,
      endpoint: "/api/leaderboard/seasons",
      method: "GET",
    },
    {
      baseUrl,
      endpoint: "/api/game/map-stats",
      method: "POST",
      body: { rooms: SAMPLE_ROOMS, statName: "owner0" },
    },
    {
      baseUrl,
      endpoint: "/api/game/room-terrain",
      method: "GET",
      query: { room: DEFAULT_TERRAIN_ROOM, encoded: 1 },
    },
  ];

  let responses: Awaited<ReturnType<typeof screepsBatchRequest>> = [];
  try {
    responses = await screepsBatchRequest(requests, {
      maxConcurrency: Math.min(6, requests.length),
    });
  } catch {
    responses = [];
  }

  const leaderboardList = responses[0]?.ok ? responses[0] : undefined;
  const leaderboardSeasons = responses[1]?.ok ? responses[1] : undefined;
  const mapStats = responses[2]?.ok ? responses[2] : undefined;
  const terrain = responses[3]?.ok ? responses[3] : undefined;

  const leaderboardPayload = leaderboardList?.data ?? leaderboardSeasons?.data ?? {};
  const { entries, dimensions } = extractLeaderboard(leaderboardPayload);
  const season = firstString([
    asRecord(leaderboardList?.data)?.season,
    asRecord(leaderboardSeasons?.data)?.season,
    asArray(leaderboardSeasons?.data)[0],
  ]);

  const mapPayload = mapStats?.data ?? {};
  const terrainPayload = terrain?.data ?? {};

  return {
    fetchedAt: new Date().toISOString(),
    baseUrl,
    leaderboard:
      entries.length > 0
        ? {
            source: leaderboardList ? "leaderboard/list" : "leaderboard/seasons",
            season,
            entries,
            dimensions,
          }
        : undefined,
    map: buildMapSummary(terrainPayload, mapPayload),
  };
}
