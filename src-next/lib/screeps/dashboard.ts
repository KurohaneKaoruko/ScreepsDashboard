import { normalizeBaseUrl, screepsBatchRequest, screepsRequest } from "./request";
import { getRoomSummariesFromCache, setRoomSummariesToCache } from "./room-summary-cache";
import { getTerrainFromCache, setTerrainToCache } from "./terrain-cache";
import type {
  DashboardSnapshot,
  QueryParams,
  RoomObjectSummary,
  RoomSummary,
  RoomThumbnail,
  ScreepsRequest,
  ScreepsResponse,
  ScreepsMethod,
  ScreepsSession,
  UserProfileSummary,
  UserResourceSummary,
} from "./types";

const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/i;
const ROOM_NAME_EXTRACT_PATTERN = /[WE]\d+[NS]\d+/i;
const SHARD_NAME_PATTERN = /^shard\d+$/i;
const PROFILE_SIGNAL_KEYS = [
  "user",
  "username",
  "name",
  "gcl",
  "power",
  "cpu",
  "memory",
  "resources",
  "credits",
  "money",
  "pixels",
] as const;
const STATS_SIGNAL_KEYS = [
  "stats",
  "gcl",
  "power",
  "cpu",
  "memory",
  "resources",
  "credits",
  "money",
  "pixels",
  "gclLevel",
  "powerLevel",
  "cpuLimit",
  "memUsed",
] as const;

interface DashboardFallbackEndpoint {
  endpoint: string;
  method: ScreepsMethod;
  query?: QueryParams;
  body?: unknown;
}

const STATS_FALLBACK_ENDPOINTS: DashboardFallbackEndpoint[] = [
  {
    endpoint: "/api/user/stats",
    method: "GET",
    query: { interval: 8, statName: "energyHarvested" },
  },
  {
    endpoint: "/api/user/stats",
    method: "GET",
    query: { interval: 8 },
  },
  { endpoint: "/api/user/stats", method: "GET" },
  {
    endpoint: "/api/user/overview",
    method: "POST",
    body: { interval: 8, statName: "energyHarvested", shard: "shard0" },
  },
];

const PROFILE_FALLBACK_ENDPOINTS: DashboardFallbackEndpoint[] = [
  { endpoint: "/api/user/me", method: "GET" },
  { endpoint: "/api/auth/me", method: "GET" },
];

function buildRoomsFallbackEndpoints(userId?: string): DashboardFallbackEndpoint[] {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const endpoints: DashboardFallbackEndpoint[] = [];

  if (normalizedUserId) {
    endpoints.push({
      endpoint: "/api/user/rooms",
      method: "GET",
      query: { id: normalizedUserId },
    });
  }

  endpoints.push({ endpoint: "/api/user/rooms", method: "GET" });

  return endpoints;
}

const DEFAULT_MEMORY_LIMIT_KB = 2_048;
const MEMORY_MB_UPPER_BOUND = 16;
const MEMORY_BYTES_LOWER_BOUND = 16_384;
const ROOM_THUMBNAIL_MAX_ATTEMPTS = 3;
const ROOM_THUMBNAIL_RETRY_BASE_MS = 450;
const ROOM_THUMBNAIL_RETRY_DELAY_MS = 12_000;
const ROOM_THUMBNAIL_NON_TRANSIENT_RETRY_DELAY_MS = 48_000;
const ROOM_THUMBNAIL_REQUEST_WINDOW_MS = 60_000;
const ROOM_THUMBNAIL_REQUEST_LIMIT = 6;
const ROOM_THUMBNAIL_ROTATE_STEP = 3;
const ROOM_THUMBNAIL_CACHE = new Map<string, string>();
const ROOM_THUMBNAIL_RETRY_AT = new Map<string, number>();
const ROOM_THUMBNAIL_REQUEST_TIMESTAMPS: number[] = [];
const ROOM_THUMBNAIL_FETCH_CURSOR = new Map<string, number>();
const ROOM_OBJECTS_MAX_ATTEMPTS = 2;
const ROOM_OBJECTS_RETRY_BASE_MS = 300;
const ROOM_OBJECTS_RETRY_DELAY_MS = 18_000;
const ROOM_OBJECTS_NON_TRANSIENT_RETRY_DELAY_MS = 60_000;
const ROOM_OBJECTS_REQUEST_WINDOW_MS = 60_000;
const ROOM_OBJECTS_REQUEST_LIMIT = 12;
const ROOM_OBJECTS_CACHE = new Map<string, RoomObjectSummary[]>();
const ROOM_OBJECTS_RETRY_AT = new Map<string, number>();
const ROOM_OBJECTS_REQUEST_TIMESTAMPS: number[] = [];
const ROOM_LEVEL_CACHE = new Map<string, number>();
const ROOM_LEVEL_RETRY_AT = new Map<string, number>();
const ROOM_LEVEL_RETRY_DELAY_MS = 30_000;
const MAP_STATS_RCL_BATCH_SIZE = 40;
const MAP_STATS_RCL_STAT_NAME = "owner0";

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toDashboardRoomKey(roomName: string, shard?: string): string {
  const normalizedRoom = roomName.trim().toUpperCase();
  const normalizedShard = shard?.trim().toLowerCase() || "unknown";
  return `${normalizedShard}:${normalizedRoom}`;
}

function buildRoomThumbnailKey(room: RoomSummary, baseUrl: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl).toLowerCase();
  return `${normalizedBase}|${toDashboardRoomKey(room.name, room.shard)}`;
}

function buildRoomObjectsKey(room: RoomSummary, baseUrl: string): string {
  return `${buildRoomThumbnailKey(room, baseUrl)}|objects`;
}

function buildRoomLevelKey(room: RoomSummary, baseUrl: string): string {
  return buildRoomThumbnailKey(room, baseUrl);
}

function buildRoomThumbnailScopeKey(session: ScreepsSession): string {
  const normalizedBase = normalizeBaseUrl(session.baseUrl).toLowerCase();
  const normalizedUsername = session.username.trim().toLowerCase();
  return `${normalizedBase}|${normalizedUsername}`;
}

function toTerrainThumbnail(room: RoomSummary, terrainEncoded: string): RoomThumbnail {
  return {
    ...room,
    terrainEncoded,
    thumbnailSource: "terrain",
  };
}

function toFallbackThumbnail(room: RoomSummary): RoomThumbnail {
  return {
    ...room,
    thumbnailSource: "fallback",
  };
}

function normalizeTerrainEncoded(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length !== 2_500) {
    return undefined;
  }

  for (const char of normalized) {
    if (char < "0" || char > "3") {
      return undefined;
    }
  }

  return normalized;
}

function pruneRoomThumbnailRequestTimestamps(now: number): void {
  while (ROOM_THUMBNAIL_REQUEST_TIMESTAMPS.length > 0) {
    const oldest = ROOM_THUMBNAIL_REQUEST_TIMESTAMPS[0];
    if (now - oldest < ROOM_THUMBNAIL_REQUEST_WINDOW_MS) {
      break;
    }
    ROOM_THUMBNAIL_REQUEST_TIMESTAMPS.shift();
  }
}

function reserveRoomThumbnailRequestSlots(count: number): number {
  if (count <= 0) {
    return 0;
  }

  const now = Date.now();
  pruneRoomThumbnailRequestTimestamps(now);
  const availableSlots = ROOM_THUMBNAIL_REQUEST_LIMIT - ROOM_THUMBNAIL_REQUEST_TIMESTAMPS.length;
  if (availableSlots <= 0) {
    return 0;
  }

  const grantedSlots = Math.min(count, availableSlots);
  for (let index = 0; index < grantedSlots; index += 1) {
    ROOM_THUMBNAIL_REQUEST_TIMESTAMPS.push(now);
  }
  return grantedSlots;
}

function canRetryRoomThumbnail(baseUrl: string, room: RoomSummary, now: number): boolean {
  const retryAt = ROOM_THUMBNAIL_RETRY_AT.get(buildRoomThumbnailKey(room, baseUrl));
  return retryAt === undefined || retryAt <= now;
}

function scheduleRoomThumbnailRetry(baseUrl: string, room: RoomSummary, delayMs: number): void {
  ROOM_THUMBNAIL_RETRY_AT.set(buildRoomThumbnailKey(room, baseUrl), Date.now() + delayMs);
}

function clearRoomThumbnailRetry(baseUrl: string, room: RoomSummary): void {
  ROOM_THUMBNAIL_RETRY_AT.delete(buildRoomThumbnailKey(room, baseUrl));
}

function pruneRoomObjectsRequestTimestamps(now: number): void {
  while (ROOM_OBJECTS_REQUEST_TIMESTAMPS.length > 0) {
    const oldest = ROOM_OBJECTS_REQUEST_TIMESTAMPS[0];
    if (now - oldest < ROOM_OBJECTS_REQUEST_WINDOW_MS) {
      break;
    }
    ROOM_OBJECTS_REQUEST_TIMESTAMPS.shift();
  }
}

function reserveRoomObjectsRequestSlots(count: number): number {
  if (count <= 0) {
    return 0;
  }

  const now = Date.now();
  pruneRoomObjectsRequestTimestamps(now);
  const availableSlots = ROOM_OBJECTS_REQUEST_LIMIT - ROOM_OBJECTS_REQUEST_TIMESTAMPS.length;
  if (availableSlots <= 0) {
    return 0;
  }

  const grantedSlots = Math.min(count, availableSlots);
  for (let index = 0; index < grantedSlots; index += 1) {
    ROOM_OBJECTS_REQUEST_TIMESTAMPS.push(now);
  }
  return grantedSlots;
}

function canRetryRoomObjects(baseUrl: string, room: RoomSummary, now: number): boolean {
  const retryAt = ROOM_OBJECTS_RETRY_AT.get(buildRoomObjectsKey(room, baseUrl));
  return retryAt === undefined || retryAt <= now;
}

function scheduleRoomObjectsRetry(baseUrl: string, room: RoomSummary, delayMs: number): void {
  ROOM_OBJECTS_RETRY_AT.set(buildRoomObjectsKey(room, baseUrl), Date.now() + delayMs);
}

function clearRoomObjectsRetry(baseUrl: string, room: RoomSummary): void {
  ROOM_OBJECTS_RETRY_AT.delete(buildRoomObjectsKey(room, baseUrl));
}

function normalizeRoomName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.trim().toUpperCase().match(ROOM_NAME_EXTRACT_PATTERN);
  return match?.[0];
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

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = asNumber(value);
    if (numberValue !== undefined) {
      return numberValue;
    }
  }
  return undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = asString(value);
    if (stringValue !== undefined) {
      return stringValue;
    }
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  const parsedString = asString(value);
  if (parsedString !== undefined) {
    return parsedString;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return undefined;
}

function firstText(values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asText(value);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function collectPayloadCandidates(
  payload: unknown,
  maxDepth = 5,
  maxNodes = 180
): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const queue: Array<{ record: Record<string, unknown>; depth: number }> = [
    { record: root, depth: 0 },
  ];
  const visited = new WeakSet<Record<string, unknown>>();
  const output: Record<string, unknown>[] = [];

  while (queue.length > 0 && output.length < maxNodes) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const { record, depth } = current;
    if (visited.has(record)) {
      continue;
    }
    visited.add(record);
    output.push(record);

    if (depth >= maxDepth) {
      continue;
    }

    const prioritized = [
      record.data,
      record.result,
      record.user,
      record.profile,
      record.stats,
      record.resources,
      record.cpu,
      record.memory,
      record.gcl,
      record.power,
      record.gpl,
      record.shards,
      record.shard0,
      record.shard1,
      record.shard2,
      record.shard3,
    ];

    for (const value of prioritized) {
      const nested = asRecord(value);
      if (nested && !visited.has(nested)) {
        queue.push({ record: nested, depth: depth + 1 });
      }
    }

    let objectCount = 0;
    for (const value of Object.values(record)) {
      if (objectCount >= 24) {
        break;
      }

      const nested = asRecord(value);
      if (nested && !visited.has(nested)) {
        queue.push({ record: nested, depth: depth + 1 });
        objectCount += 1;
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value.slice(0, 8)) {
          const listRecord = asRecord(item);
          if (listRecord && !visited.has(listRecord)) {
            queue.push({ record: listRecord, depth: depth + 1 });
            objectCount += 1;
            if (objectCount >= 24) {
              break;
            }
          }
        }
      }
    }
  }

  return output;
}

function collectRoomObjectRecordsFromValue(
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

  for (const [key, nested] of Object.entries(record)) {
    const nestedRecord = asRecord(nested);
    if (!nestedRecord) {
      continue;
    }

    const nestedX = asNumber(nestedRecord.x);
    const nestedY = asNumber(nestedRecord.y);
    if (nestedX === undefined || nestedY === undefined) {
      continue;
    }

    if (nestedRecord._id || nestedRecord.id) {
      sink.push(nestedRecord);
      continue;
    }

    sink.push({
      ...nestedRecord,
      _id: key,
    });
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
    collectRoomObjectRecordsFromValue(candidate, objectRecords);
  }

  if (objectRecords.length > 0) {
    return objectRecords;
  }

  const fallbackCandidates = collectPayloadCandidates(payload, 6, 260);
  return fallbackCandidates.filter((record) => {
    const x = asNumber(record.x);
    const y = asNumber(record.y);
    return x !== undefined && y !== undefined;
  });
}

function extractObjectRoomName(record: Record<string, unknown>): string | undefined {
  const position = asRecord(record.pos);
  return normalizeRoomName(
    firstString([record.room, record.roomName, position?.roomName, position?.room])
  );
}

function resolveRoomObjectType(record: Record<string, unknown>): string | undefined {
  const directType = firstString([record.type, record.objectType, record.structureType]);
  if (directType) {
    return directType;
  }

  if (firstString([record.mineralType])) {
    return "mineral";
  }
  if (firstString([record.depositType])) {
    return "deposit";
  }
  if (firstNumber([record.progress, record.progressTotal]) !== undefined) {
    return "constructionSite";
  }
  if (firstNumber([record.ticksToLive, record.ttl]) !== undefined) {
    return "creep";
  }

  const resourceType = firstString([record.resourceType, record.resource]);
  if (resourceType === "energy" && firstNumber([record.amount, record.energy]) !== undefined) {
    return "energy";
  }

  return undefined;
}

function parseRoomObjectsForThumbnail(roomName: string, payload: unknown): RoomObjectSummary[] {
  const normalizedRoomName = normalizeRoomName(roomName) ?? roomName.trim().toUpperCase();
  const objectRecords = extractRoomObjectRecords(payload);
  if (objectRecords.length === 0) {
    return [];
  }

  const summaries = new Map<string, RoomObjectSummary>();
  const maxObjects = 1_400;
  for (const record of objectRecords) {
    const x = asNumber(record.x);
    const y = asNumber(record.y);
    if (x === undefined || y === undefined || x < 0 || x > 49 || y < 0 || y > 49) {
      continue;
    }

    const recordRoom = extractObjectRoomName(record);
    if (recordRoom && recordRoom !== normalizedRoomName) {
      continue;
    }

    const type = resolveRoomObjectType(record);
    if (!type) {
      continue;
    }

    const ownerRecord = asRecord(record.owner);
    const id =
      firstString([record._id, record.id]) ?? `${type}:${x}:${y}:${summaries.size + 1}`;
    const objectSummary: RoomObjectSummary = {
      id,
      type,
      x,
      y,
      owner: firstString([
        record.owner,
        ownerRecord?.username,
        ownerRecord?.name,
        ownerRecord?.user,
      ]),
      name: firstString([record.name, record.creepName]),
      hits: asNumber(record.hits),
      hitsMax: asNumber(record.hitsMax),
      ttl: firstNumber([record.ticksToLive, record.ttl]),
      user: firstString([record.user, ownerRecord?.user, record.userId]),
      userId: firstString([record.userId, record.user, ownerRecord?.user]),
      energy: firstNumber([record.energy]),
      energyCapacity: firstNumber([record.energyCapacity]),
      level: asNumber(record.level),
      progress: firstNumber([record.progress]),
      progressTotal: firstNumber([record.progressTotal, record.total]),
      mineralType: firstString([record.mineralType]),
      depositType: firstString([record.depositType]),
    };

    const key = `${type}:${x}:${y}:${id}`;
    summaries.set(key, objectSummary);
    if (summaries.size >= maxObjects) {
      break;
    }
  }

  return [...summaries.values()];
}

function scorePayloadCandidate(record: Record<string, unknown>, keys: readonly string[]): number {
  let score = 0;

  for (const key of keys) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }

    score += 3;
    if (typeof value === "number") {
      score += 2;
    } else if (typeof value === "string") {
      score += 1;
    } else if (typeof value === "object" && value !== null) {
      score += 2;
    }
  }

  if (asRecord(record.user)) {
    score += 1;
  }
  if (asRecord(record.stats)) {
    score += 1;
  }
  if (asRecord(record.resources)) {
    score += 1;
  }

  let numericFields = 0;
  for (const value of Object.values(record)) {
    if (asNumber(value) !== undefined) {
      numericFields += 1;
    }
    if (numericFields >= 6) {
      break;
    }
  }
  score += numericFields;

  return score;
}

function pickPayloadRecord(
  payload: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  const candidates = collectPayloadCandidates(payload);
  if (candidates.length === 0) {
    return {};
  }

  let best = candidates[0];
  let bestScore = scorePayloadCandidate(best, keys);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scorePayloadCandidate(candidate, keys);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value > 0 && value <= 1) {
    return value * 100;
  }
  return value;
}

interface DerivedLevelProgress {
  level: number;
  progress: number;
  progressTotal: number;
  progressPercent: number;
}

function deriveLevelProgressFromPoints(
  totalPoints: number | undefined,
  multiply: number,
  pow: number
): DerivedLevelProgress | undefined {
  if (totalPoints === undefined || !Number.isFinite(totalPoints) || totalPoints < 0) {
    return undefined;
  }

  function threshold(level: number): number {
    return Math.floor(Math.pow(level, pow) * multiply);
  }

  let level = Math.max(1, Math.floor(Math.pow(totalPoints / multiply, 1 / pow)) + 1);

  while (level < 100_000 && threshold(level) <= totalPoints) {
    level += 1;
  }
  while (level > 1 && threshold(level - 1) > totalPoints) {
    level -= 1;
  }

  const previousTotal = level > 1 ? threshold(level - 1) : 0;
  const nextTotal = threshold(level);
  const progress = Math.max(0, totalPoints - previousTotal);
  const progressTotal = Math.max(1, nextTotal - previousTotal);
  const progressPercent = (progress / progressTotal) * 100;

  return {
    level,
    progress,
    progressTotal,
    progressPercent,
  };
}

function isLikelyLevel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1000;
}

function firstLikelyLevel(values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== undefined && isLikelyLevel(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toPercent(used: number | undefined, limit: number | undefined): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) {
    return undefined;
  }
  return (used / limit) * 100;
}

function normalizeMemoryValueToKB(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) {
    return value;
  }

  if (value > MEMORY_BYTES_LOWER_BOUND) {
    return value / 1024;
  }

  if (value <= MEMORY_MB_UPPER_BOUND) {
    return value * 1024;
  }

  return value;
}

function normalizeMemoryToKB(
  used: number | undefined,
  limit: number | undefined
): { used?: number; limit?: number } {
  return {
    used: normalizeMemoryValueToKB(used),
    limit: normalizeMemoryValueToKB(limit),
  };
}

function pickAvatarUrl(baseUrl: string, username: string, payload: unknown): string | undefined {
  const root = pickPayloadRecord(payload, PROFILE_SIGNAL_KEYS);
  const user = asRecord(root.user) ?? root;

  const direct = firstString([
    user.avatarUrl,
    user.avatarURL,
    user.avatar,
    root.avatarUrl,
    root.avatarURL,
    root.avatar,
  ]);

  if (direct) {
    if (/^https?:\/\//i.test(direct)) {
      return direct;
    }
    if (direct.startsWith("/")) {
      return `${normalizeBaseUrl(baseUrl)}${direct}`;
    }
  }

  if (username) {
    return `${normalizeBaseUrl(baseUrl)}/api/user/avatar?username=${encodeURIComponent(username)}`;
  }

  return undefined;
}

function extractResources(profilePayload: unknown, statsPayload?: unknown): UserResourceSummary {
  const root = pickPayloadRecord(profilePayload, PROFILE_SIGNAL_KEYS);
  const user = asRecord(root.user) ?? root;
  const rootResources = asRecord(root.resources) ?? {};
  const userResources = asRecord(user.resources) ?? {};

  const stats = pickPayloadRecord(statsPayload, STATS_SIGNAL_KEYS);
  const statsUser = asRecord(stats.user) ?? {};
  const statsResources = asRecord(stats.resources) ?? {};
  const statsUserResources = asRecord(statsUser.resources) ?? {};

  return {
    credits: firstNumber([
      user.money,
      user.credits,
      userResources.money,
      userResources.credits,
      root.money,
      root.credits,
      rootResources.money,
      rootResources.credits,
      stats.credits,
      stats.money,
      statsUser.credits,
      statsUser.money,
      statsResources.credits,
      statsResources.money,
      statsUserResources.credits,
      statsUserResources.money,
    ]),
    cpuUnlock: firstNumber([
      user.cpuUnlock,
      user.cpuUnlocks,
      userResources.cpuUnlock,
      userResources.cpuUnlocks,
      root.cpuUnlock,
      root.cpuUnlocks,
      rootResources.cpuUnlock,
      rootResources.cpuUnlocks,
      stats.cpuUnlock,
      stats.cpuUnlocks,
      statsUser.cpuUnlock,
      statsUser.cpuUnlocks,
      statsResources.cpuUnlock,
      statsResources.cpuUnlocks,
      statsUserResources.cpuUnlock,
      statsUserResources.cpuUnlocks,
    ]),
    pixels: firstNumber([
      user.pixels,
      user.pixel,
      userResources.pixels,
      userResources.pixel,
      root.pixels,
      root.pixel,
      rootResources.pixels,
      rootResources.pixel,
      stats.pixels,
      stats.pixel,
      statsUser.pixels,
      statsUser.pixel,
      statsResources.pixels,
      statsResources.pixel,
      statsUserResources.pixels,
      statsUserResources.pixel,
    ]),
    accessKey: firstText([
      user.accessKey,
      user.accesskey,
      userResources.accessKey,
      userResources.accesskey,
      root.accessKey,
      root.accesskey,
      rootResources.accessKey,
      rootResources.accesskey,
      stats.accessKey,
      stats.accesskey,
      statsUser.accessKey,
      statsUser.accesskey,
      statsResources.accessKey,
      statsResources.accesskey,
      statsUserResources.accessKey,
      statsUserResources.accesskey,
    ]),
  };
}

function extractProfile(
  session: ScreepsSession,
  profilePayload: unknown,
  statsPayload?: unknown
): UserProfileSummary {
  const root = pickPayloadRecord(profilePayload, PROFILE_SIGNAL_KEYS);
  const user = asRecord(root.user) ?? root;
  const rootResources = asRecord(root.resources) ?? {};
  const userResources = asRecord(user.resources) ?? {};

  const stats = pickPayloadRecord(statsPayload, STATS_SIGNAL_KEYS);
  const statsUser = asRecord(stats.user) ?? {};
  const statsResources = asRecord(stats.resources) ?? {};
  const statsUserResources = asRecord(statsUser.resources) ?? {};

  const cpu =
    asRecord(user.cpu) ??
    asRecord(root.cpu) ??
    asRecord(statsUser.cpu) ??
    asRecord(stats.cpu) ??
    {};
  const gcl =
    asRecord(user.gcl) ??
    asRecord(root.gcl) ??
    asRecord(statsUser.gcl) ??
    asRecord(stats.gcl) ??
    asRecord(stats.gclInfo) ??
    {};
  const gpl =
    asRecord(user.power) ??
    asRecord(root.power) ??
    asRecord(user.gpl) ??
    asRecord(root.gpl) ??
    asRecord(statsUser.power) ??
    asRecord(stats.power) ??
    asRecord(stats.gpl) ??
    asRecord(stats.powerInfo) ??
    asRecord(stats.gplInfo) ??
    {};
  const mem =
    asRecord(user.memory) ??
    asRecord(root.memory) ??
    asRecord(user.mem) ??
    asRecord(root.mem) ??
    asRecord(statsUser.memory) ??
    asRecord(stats.memory) ??
    asRecord(stats.mem) ??
    {};
  const runtime =
    asRecord(user.runtime) ??
    asRecord(root.runtime) ??
    asRecord(statsUser.runtime) ??
    asRecord(stats.runtime) ??
    {};
  const runtimeCpu = asRecord(runtime.cpu) ?? {};
  const runtimeMem = asRecord(runtime.memory) ?? asRecord(runtime.mem) ?? {};
  const runtimeQos = asRecord(runtime.qos) ?? {};

  const username =
    firstString([
      user.username,
      user.name,
      root.username,
      root.name,
      statsUser.username,
      statsUser.name,
      stats.username,
      stats.name,
      user._id,
      root._id,
    ]) ?? session.username;
  const userId = firstString([
    user._id,
    root._id,
    statsUser._id,
    stats._id,
    user.id,
    root.id,
    statsUser.id,
    stats.id,
  ]);

  const cpuScalar = firstNumber([user.cpu, root.cpu, statsUser.cpu, stats.cpu]);
  const gclTotalPoints = firstNumber([
    gcl.points,
    gcl.totalPoints,
    user.gclPoints,
    root.gclPoints,
    statsUser.gclPoints,
    stats.gclPoints,
    user.gcl,
    root.gcl,
    statsUser.gcl,
    stats.gcl,
  ]);
  const gplTotalPoints = firstNumber([
    gpl.points,
    gpl.totalPoints,
    user.powerPoints,
    root.powerPoints,
    user.gplPoints,
    root.gplPoints,
    statsUser.powerPoints,
    stats.powerPoints,
    statsUser.gplPoints,
    stats.gplPoints,
    user.power,
    root.power,
    statsUser.power,
    stats.power,
  ]);

  const cpuLimit = firstNumber([
    cpu.limit,
    cpu.max,
    user.cpuLimit,
    user.cpuMax,
    root.cpuLimit,
    root.cpuMax,
    stats.cpuLimit,
    statsUser.cpuLimit,
    userResources.cpuLimit,
    rootResources.cpuLimit,
    statsResources.cpuLimit,
    statsUserResources.cpuLimit,
    cpuScalar,
  ]);
  const cpuUsed = firstNumber([
    cpu.used,
    cpu.current,
    user.cpuUsed,
    user.cpuCurrent,
    root.cpuUsed,
    stats.cpuUsed,
    stats.cpuCurrent,
    statsUser.cpuUsed,
    statsUser.cpuCurrent,
    runtimeCpu.used,
    runtimeCpu.current,
    runtime.cpuUsed,
    runtime.cpu,
    runtime.used,
  ]);
  const cpuBucket = firstNumber([
    cpu.bucket,
    user.cpuBucket,
    root.cpuBucket,
    stats.cpuBucket,
    statsUser.cpuBucket,
    userResources.cpuBucket,
    rootResources.cpuBucket,
    statsResources.cpuBucket,
    statsUserResources.cpuBucket,
    runtimeCpu.bucket,
    runtime.bucket,
    runtimeQos.bucket,
  ]);

  const gclLevel = firstLikelyLevel([
    gcl.level,
    user.gclLevel,
    root.gclLevel,
    statsUser.gclLevel,
    stats.gclLevel,
    user.gcl,
    root.gcl,
    statsUser.gcl,
    stats.gcl,
  ]);
  const gclProgress = firstNumber([
    gcl.progress,
    gcl.current,
    user.gclProgress,
    root.gclProgress,
    statsUser.gclProgress,
    stats.gclProgress,
    stats.gclCurrent,
  ]);
  const gclProgressTotal = firstNumber([
    gcl.progressTotal,
    gcl.total,
    user.gclProgressTotal,
    root.gclProgressTotal,
    statsUser.gclProgressTotal,
    stats.gclProgressTotal,
    stats.gclTotal,
  ]);
  const gclRank = firstNumber([
    gcl.rank,
    gcl.position,
    user.gclRank,
    root.gclRank,
    statsUser.gclRank,
    stats.gclRank,
    stats.rankGcl,
    stats.gclPosition,
  ]);
  const gclProgressPercent = firstNumber([
    gcl.progressPercent,
    gcl.progressPct,
    gcl.pct,
    user.gclProgressPercent,
    root.gclProgressPercent,
    statsUser.gclProgressPercent,
    stats.gclProgressPercent,
    stats.gclPercent,
    stats.gclPct,
    stats.gclRatio,
  ]);

  const gplLevel = firstLikelyLevel([
    gpl.level,
    user.gplLevel,
    user.powerLevel,
    root.gplLevel,
    root.powerLevel,
    statsUser.gplLevel,
    statsUser.powerLevel,
    stats.gplLevel,
    stats.powerLevel,
    user.power,
    root.power,
    statsUser.power,
    stats.power,
  ]);
  const gplProgress = firstNumber([
    gpl.progress,
    gpl.current,
    user.gplProgress,
    user.powerProgress,
    root.gplProgress,
    root.powerProgress,
    statsUser.gplProgress,
    statsUser.powerProgress,
    stats.gplProgress,
    stats.powerProgress,
    stats.gplCurrent,
  ]);
  const gplProgressTotal = firstNumber([
    gpl.progressTotal,
    gpl.total,
    user.gplProgressTotal,
    user.powerProgressTotal,
    root.gplProgressTotal,
    root.powerProgressTotal,
    statsUser.gplProgressTotal,
    statsUser.powerProgressTotal,
    stats.gplProgressTotal,
    stats.powerProgressTotal,
    stats.gplTotal,
  ]);
  const gplRank = firstNumber([
    gpl.rank,
    gpl.position,
    user.gplRank,
    user.powerRank,
    root.gplRank,
    root.powerRank,
    statsUser.gplRank,
    statsUser.powerRank,
    stats.gplRank,
    stats.powerRank,
    stats.rankPower,
    stats.gplPosition,
    stats.powerPosition,
  ]);
  const gplProgressPercent = firstNumber([
    gpl.progressPercent,
    gpl.progressPct,
    gpl.pct,
    user.gplProgressPercent,
    user.powerProgressPercent,
    root.gplProgressPercent,
    root.powerProgressPercent,
    statsUser.gplProgressPercent,
    statsUser.powerProgressPercent,
    stats.gplProgressPercent,
    stats.powerProgressPercent,
    stats.gplPercent,
    stats.powerPercent,
    stats.gplPct,
    stats.powerPct,
    stats.powerRatio,
  ]);

  const rawMemUsed = firstNumber([
    mem.used,
    mem.current,
    user.memUsed,
    user.memoryUsed,
    root.memUsed,
    root.memoryUsed,
    stats.memUsed,
    stats.memoryUsed,
    statsUser.memUsed,
    statsUser.memoryUsed,
    runtimeMem.used,
    runtimeMem.current,
    runtime.memUsed,
    runtime.memoryUsed,
    runtime.memory,
  ]);
  const rawMemLimit = firstNumber([
    mem.limit,
    mem.max,
    user.memLimit,
    user.memoryLimit,
    root.memLimit,
    root.memoryLimit,
    stats.memLimit,
    stats.memoryLimit,
    statsUser.memLimit,
    statsUser.memoryLimit,
    runtimeMem.limit,
    runtimeMem.max,
    runtime.memLimit,
    runtime.memoryLimit,
  ]);
  const normalizedMemory = normalizeMemoryToKB(rawMemUsed, rawMemLimit);
  const memUsed = normalizedMemory.used;
  const memLimit = normalizedMemory.limit;
  const memPercent = normalizePercent(
    firstNumber([
      mem.percent,
      mem.pct,
      user.memPercent,
      root.memPercent,
      stats.memPercent,
      stats.memoryPercent,
      statsUser.memPercent,
      statsUser.memoryPercent,
      runtimeMem.percent,
      runtimeMem.pct,
      runtime.memPercent,
      runtime.memoryPercent,
      runtimeMem.ratio,
      runtime.memoryRatio,
    ])
  );

  const derivedGcl =
    gclLevel === undefined && gclTotalPoints !== undefined && gclTotalPoints > 1000
      ? deriveLevelProgressFromPoints(gclTotalPoints, 1_000_000, 2.4)
      : undefined;
  const derivedGpl =
    gplLevel === undefined && gplTotalPoints !== undefined && gplTotalPoints > 1000
      ? deriveLevelProgressFromPoints(gplTotalPoints, 1_000, 2)
      : undefined;

  const resolvedGclLevel = gclLevel ?? derivedGcl?.level;
  const resolvedGclProgress = gclProgress ?? derivedGcl?.progress;
  const resolvedGclProgressTotal = gclProgressTotal ?? derivedGcl?.progressTotal;
  const resolvedGclProgressPercent = normalizePercent(
    gclProgressPercent ??
      derivedGcl?.progressPercent ??
      toPercent(resolvedGclProgress, resolvedGclProgressTotal)
  );

  const resolvedGplLevel = gplLevel ?? derivedGpl?.level;
  const resolvedGplProgress = gplProgress ?? derivedGpl?.progress;
  const resolvedGplProgressTotal = gplProgressTotal ?? derivedGpl?.progressTotal;
  const resolvedGplProgressPercent = normalizePercent(
    gplProgressPercent ??
      derivedGpl?.progressPercent ??
      toPercent(resolvedGplProgress, resolvedGplProgressTotal)
  );
  return {
    avatarUrl: pickAvatarUrl(session.baseUrl, username, profilePayload),
    userId,
    username,
    gclLevel: resolvedGclLevel,
    gclProgress: resolvedGclProgress,
    gclProgressTotal: resolvedGclProgressTotal,
    gclProgressPercent: resolvedGclProgressPercent,
    gclRank,
    gplLevel: resolvedGplLevel,
    gplProgress: resolvedGplProgress,
    gplProgressTotal: resolvedGplProgressTotal,
    gplProgressPercent: resolvedGplProgressPercent,
    gplRank,
    cpuLimit,
    cpuUsed,
    cpuBucket,
    memUsed,
    memLimit,
    memPercent: memPercent ?? toPercent(memUsed, memLimit),
    resources: extractResources(profilePayload, statsPayload),
  };
}

function extractProfileUserId(payload: unknown): string | undefined {
  const root = pickPayloadRecord(payload, PROFILE_SIGNAL_KEYS);
  const user = asRecord(root.user) ?? {};
  return firstString([user._id, user.id, root._id, root.id, root.userId]);
}

function mergeRoomSummary(
  sink: Map<string, RoomSummary>,
  roomName: string,
  payload: unknown,
  shardHint?: string
): void {
  const record = asRecord(payload) ?? {};
  const controller = asRecord(record.controller) ?? {};
  const own = asRecord(record.own) ?? {};
  const owner0 = asRecord(record.owner0) ?? {};
  const status = asRecord(record.status) ?? {};
  const stats = asRecord(record.stats) ?? {};
  const statsController = asRecord(stats.controller) ?? {};
  const previous = sink.get(roomName);
  const shardCandidate = firstString([
    record.shard,
    record.shardName,
    shardHint,
    previous?.shard,
  ]);
  const shard =
    shardCandidate && SHARD_NAME_PATTERN.test(shardCandidate)
      ? shardCandidate.toLowerCase()
      : previous?.shard;

  const owner = firstString([
    record.owner,
    controller.user,
    controller.owner,
    own.user,
    own.owner,
    owner0.user,
    owner0.owner,
    previous?.owner,
  ]);
  const level = firstLikelyLevel([
    controller.level,
    record.level,
    record.rcl,
    record.controllerLevel,
    record.cl,
    own.level,
    owner0.level,
    status.level,
    stats.level,
    statsController.level,
    previous?.level,
  ]);
  const energyAvailable = firstNumber([
    record.energyAvailable,
    record.energy,
    previous?.energyAvailable,
  ]);
  const energyCapacity = firstNumber([
    record.energyCapacityAvailable,
    record.energyCapacity,
    previous?.energyCapacity,
  ]);

  sink.set(roomName, {
    name: roomName,
    shard,
    owner,
    level,
    energyAvailable,
    energyCapacity,
  });
}

function collectRoomSummary(
  value: unknown,
  sink: Map<string, RoomSummary>,
  depth: number,
  shardHint?: string
): void {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const name = asString(item);
      const normalizedName = normalizeRoomName(name);
      if (normalizedName && ROOM_NAME_PATTERN.test(normalizedName)) {
        mergeRoomSummary(sink, normalizedName, {}, shardHint);
      }
      collectRoomSummary(item, sink, depth + 1, shardHint);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const explicitShard = firstString([record.shard, record.shardName]);
  const normalizedShard =
    explicitShard && SHARD_NAME_PATTERN.test(explicitShard)
      ? explicitShard.toLowerCase()
      : shardHint;
  const roomName = normalizeRoomName(
    firstString([record.room, record.roomName, record.name, record._id])
  );

  if (roomName && ROOM_NAME_PATTERN.test(roomName)) {
    mergeRoomSummary(sink, roomName, record, normalizedShard);
  }

  for (const [key, nested] of Object.entries(record)) {
    const normalizedKeyRoom = normalizeRoomName(key);
    if (normalizedKeyRoom && ROOM_NAME_PATTERN.test(normalizedKeyRoom)) {
      mergeRoomSummary(sink, normalizedKeyRoom, nested, normalizedShard);
    }
    const nextShard = SHARD_NAME_PATTERN.test(key) ? key.toLowerCase() : normalizedShard;
    collectRoomSummary(nested, sink, depth + 1, nextShard);
  }
}

function extractRooms(roomsPayload: unknown, profilePayload: unknown): RoomSummary[] {
  const sink = new Map<string, RoomSummary>();
  collectRoomSummary(roomsPayload, sink, 0);

  if (sink.size === 0) {
    collectRoomSummary(profilePayload, sink, 0);
  }

  return [...sink.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedChunkSize) {
    output.push(items.slice(index, index + normalizedChunkSize));
  }
  return output;
}

function mergeRoomSummaries(
  baseRooms: RoomSummary[],
  payload: unknown,
  shardHint?: string
): RoomSummary[] {
  const sink = new Map<string, RoomSummary>();
  for (const room of baseRooms) {
    sink.set(room.name, room);
  }
  collectRoomSummary(payload, sink, 0, shardHint);
  return [...sink.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function buildRoomLevelMap(baseUrl: string, rooms: RoomSummary[]): Map<string, number> {
  const levelByKey = new Map<string, number>();
  for (const room of rooms) {
    if (room.level === undefined) {
      continue;
    }
    levelByKey.set(buildRoomLevelKey(room, baseUrl), room.level);
  }
  return levelByKey;
}

function applyRoomLevelCache(baseUrl: string, rooms: RoomSummary[]): RoomSummary[] {
  return rooms.map((room) => {
    if (room.level !== undefined) {
      ROOM_LEVEL_CACHE.set(buildRoomLevelKey(room, baseUrl), room.level);
      return room;
    }

    const cachedLevel = ROOM_LEVEL_CACHE.get(buildRoomLevelKey(room, baseUrl));
    if (cachedLevel === undefined) {
      return room;
    }

    return {
      ...room,
      level: cachedLevel,
    };
  });
}

async function hydrateRoomLevelsFromMapStats(
  session: ScreepsSession,
  rooms: RoomSummary[]
): Promise<RoomSummary[]> {
  if (!rooms.length) {
    return rooms;
  }

  let mergedRooms = applyRoomLevelCache(session.baseUrl, rooms);
  const now = Date.now();
  const pendingByShard = new Map<string, RoomSummary[]>();

  for (const room of mergedRooms) {
    if (room.level !== undefined) {
      continue;
    }

    const roomKey = buildRoomLevelKey(room, session.baseUrl);
    const retryAt = ROOM_LEVEL_RETRY_AT.get(roomKey);
    if (retryAt !== undefined && retryAt > now) {
      continue;
    }

    const shardKey = room.shard?.trim().toLowerCase() ?? "";
    const shardRooms = pendingByShard.get(shardKey);
    if (shardRooms) {
      shardRooms.push(room);
    } else {
      pendingByShard.set(shardKey, [room]);
    }
  }

  if (pendingByShard.size === 0) {
    return mergedRooms;
  }

  for (const [shardKey, shardRooms] of pendingByShard) {
    const chunks = splitIntoChunks(shardRooms, MAP_STATS_RCL_BATCH_SIZE);
    for (const roomChunk of chunks) {
      const roomNames = roomChunk.map((room) => room.name);
      const requestBodies: Array<{ rooms: string[]; statName: string; shard?: string }> = [];

      if (shardKey) {
        requestBodies.push({
          rooms: roomNames,
          statName: MAP_STATS_RCL_STAT_NAME,
          shard: shardKey,
        });
      }
      requestBodies.push({
        rooms: roomNames,
        statName: MAP_STATS_RCL_STAT_NAME,
      });

      const responses = await screepsBatchRequest(
        requestBodies.map((body) => ({
          baseUrl: session.baseUrl,
          endpoint: "/api/game/map-stats",
          method: "POST",
          body,
          token: session.token,
          username: session.username,
        })),
        { maxConcurrency: Math.min(3, requestBodies.length) }
      );

      for (const response of responses) {
        if (!response.ok) {
          continue;
        }

        mergedRooms = mergeRoomSummaries(mergedRooms, response.data, shardKey || undefined);

        const levelByKey = buildRoomLevelMap(session.baseUrl, mergedRooms);
        const unresolvedCount = roomChunk.reduce((count, room) => {
          const roomLevel = levelByKey.get(buildRoomLevelKey(room, session.baseUrl));
          return roomLevel === undefined ? count + 1 : count;
        }, 0);

        if (unresolvedCount === 0) {
          break;
        }
      }

      const resolvedLevels = buildRoomLevelMap(session.baseUrl, mergedRooms);
      const retryAt = Date.now() + ROOM_LEVEL_RETRY_DELAY_MS;
      for (const room of roomChunk) {
        const roomKey = buildRoomLevelKey(room, session.baseUrl);
        const resolvedLevel = resolvedLevels.get(roomKey);
        if (resolvedLevel !== undefined) {
          ROOM_LEVEL_CACHE.set(roomKey, resolvedLevel);
          ROOM_LEVEL_RETRY_AT.delete(roomKey);
        } else {
          ROOM_LEVEL_RETRY_AT.set(roomKey, retryAt);
        }
      }
    }
  }

  return mergedRooms;
}

function endpointIdentity(
  endpoint: string,
  method: ScreepsMethod | undefined,
  query?: QueryParams,
  body?: unknown
): string {
  return `${(method ?? "GET").toUpperCase()} ${endpoint} q:${JSON.stringify(query ?? {})} b:${JSON.stringify(body ?? null)}`;
}

function hasUsefulStatsPayload(payload: unknown): boolean {
  const stats = pickPayloadRecord(payload, STATS_SIGNAL_KEYS);
  const statsUser = asRecord(stats.user) ?? {};
  const statsResources = asRecord(stats.resources) ?? {};

  return [
    stats.gcl,
    stats.power,
    stats.cpu,
    stats.memory,
    stats.gclLevel,
    stats.powerLevel,
    stats.gclProgress,
    stats.powerProgress,
    stats.cpuLimit,
    stats.cpuUsed,
    stats.cpuBucket,
    stats.memUsed,
    stats.memLimit,
    stats.credits,
    stats.money,
    stats.pixels,
    statsUser.gcl,
    statsUser.power,
    statsUser.cpu,
    statsUser.memory,
    statsUser.gclLevel,
    statsUser.powerLevel,
    statsResources.credits,
    statsResources.cpuUnlock,
    statsResources.pixels,
  ].some((value) => value !== undefined);
}

function hasUsefulRoomsPayload(payload: unknown): boolean {
  return extractRooms(payload, undefined).length > 0;
}

async function tryFallbackPayload(
  session: ScreepsSession,
  candidates: DashboardFallbackEndpoint[],
  selected?: { endpoint: string; method?: ScreepsMethod; query?: QueryParams; body?: unknown },
  validator?: (payload: unknown) => boolean
): Promise<unknown | undefined> {
  const selectedKey = selected
    ? endpointIdentity(selected.endpoint, selected.method, selected.query, selected.body)
    : undefined;

  const filteredCandidates = candidates.filter(
    (candidate) =>
      endpointIdentity(candidate.endpoint, candidate.method, candidate.query, candidate.body) !==
      selectedKey
  );

  if (filteredCandidates.length === 0) {
    return undefined;
  }

  const responses = await screepsBatchRequest(
    filteredCandidates.map((candidate) => ({
      baseUrl: session.baseUrl,
      endpoint: candidate.endpoint,
      method: candidate.method,
      query: candidate.query,
      body: candidate.body,
      token: session.token,
      username: session.username,
    })),
    { maxConcurrency: Math.min(6, filteredCandidates.length) }
  );

  for (let index = 0; index < filteredCandidates.length; index += 1) {
    const response = responses[index];
    if (!response?.ok) {
      continue;
    }
    if (validator && !validator(response.data)) {
      continue;
    }
    return response.data;
  }

  return undefined;
}

function getResponseError(response: ScreepsResponse): string {
  const payload = asRecord(response.data);
  const message = firstString([payload?.error, payload?.message, payload?.text]);
  return message ? `${response.status}: ${message}` : `${response.status}`;
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
  const direct = extractTerrainString(payload);
  if (direct) {
    return direct;
  }

  const root = pickPayloadRecord(payload, ["terrain", "encodedTerrain", "roomTerrain"]);
  return (
    extractTerrainString(root.terrain) ??
    extractTerrainString(root.encodedTerrain) ??
    extractTerrainString(root.roomTerrain) ??
    extractTerrainString(root.text) ??
    extractTerrainString(root.data)
  );
}

function extractResponseText(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  const record = asRecord(payload) ?? {};
  return firstString([record.text, record.svg, record.data, record.badgeSvg]);
}

function toSvgDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

async function fetchBadgeAvatar(
  baseUrl: string,
  token: string,
  username: string
): Promise<string | undefined> {
  if (!username) {
    return undefined;
  }

  try {
    const response = await screepsRequest({
      baseUrl,
      endpoint: "/api/user/badge-svg",
      method: "GET",
      query: { username },
      token,
      username,
    });

    if (!response.ok) {
      return undefined;
    }

    const svgText = extractResponseText(response.data);
    if (!svgText || !svgText.includes("<svg")) {
      return undefined;
    }

    return toSvgDataUrl(svgText);
  } catch {
    return undefined;
  }
}

async function fetchRoomThumbnail(
  baseUrl: string,
  token: string,
  username: string,
  room: RoomSummary
): Promise<RoomThumbnail> {
  const roomKey = buildRoomThumbnailKey(room, baseUrl);
  const cachedTerrainRaw =
    ROOM_THUMBNAIL_CACHE.get(roomKey) ??
    getTerrainFromCache(baseUrl, room.name, room.shard);
  const cachedTerrain = normalizeTerrainEncoded(cachedTerrainRaw);
  if (!cachedTerrain && cachedTerrainRaw) {
    ROOM_THUMBNAIL_CACHE.delete(roomKey);
  }
  if (cachedTerrain) {
    ROOM_THUMBNAIL_CACHE.set(roomKey, cachedTerrain);
    return toTerrainThumbnail(room, cachedTerrain);
  }

  const terrainQueries: QueryParams[] = [];

  if (room.shard) {
    terrainQueries.push({ room: room.name, encoded: 1, shard: room.shard });
  }
  terrainQueries.push({ room: room.name, encoded: 1 });
  if (!room.shard || room.shard !== "shard0") {
    terrainQueries.push({ room: room.name, encoded: 1, shard: "shard0" });
  }

  let transientOrUnknownFailure = false;
  for (let attempt = 0; attempt < ROOM_THUMBNAIL_MAX_ATTEMPTS; attempt += 1) {
    let shouldRetry = false;
    let rateLimited = false;

    const grantedQueryCount = reserveRoomThumbnailRequestSlots(terrainQueries.length);
    if (grantedQueryCount <= 0) {
      shouldRetry = true;
      rateLimited = true;
      transientOrUnknownFailure = true;
      break;
    }

    const requestQueries = terrainQueries.slice(0, grantedQueryCount);
    const responses = await screepsBatchRequest(
      requestQueries.map((query) => ({
        baseUrl,
        endpoint: "/api/game/room-terrain",
        method: "GET",
        query,
        token,
        username,
      })),
      { maxConcurrency: grantedQueryCount }
    );

    for (const response of responses) {
      if (!response.ok) {
        if (isTransientStatus(response.status) || response.status === 0) {
          shouldRetry = true;
          transientOrUnknownFailure = true;
        }
        continue;
      }

      const terrainEncoded = normalizeTerrainEncoded(extractTerrain(response.data));
      if (!terrainEncoded) {
        // Some servers occasionally return empty payloads; retry with backoff.
        shouldRetry = true;
        transientOrUnknownFailure = true;
        continue;
      }

      ROOM_THUMBNAIL_CACHE.set(roomKey, terrainEncoded);
      setTerrainToCache(baseUrl, room.name, terrainEncoded, room.shard);
      clearRoomThumbnailRetry(baseUrl, room);
      return toTerrainThumbnail(room, terrainEncoded);
    }

    if (rateLimited) {
      break;
    }
    if (!shouldRetry || attempt >= ROOM_THUMBNAIL_MAX_ATTEMPTS - 1) {
      break;
    }

    await wait((attempt + 1) * ROOM_THUMBNAIL_RETRY_BASE_MS);
  }

  scheduleRoomThumbnailRetry(
    baseUrl,
    room,
    transientOrUnknownFailure
      ? ROOM_THUMBNAIL_RETRY_DELAY_MS
      : ROOM_THUMBNAIL_NON_TRANSIENT_RETRY_DELAY_MS
  );
  return toFallbackThumbnail(room);
}

interface RoomObjectsRequestCandidate {
  endpoint: string;
  method: ScreepsMethod;
  query?: QueryParams;
  body?: unknown;
}

function buildRoomObjectsRequests(room: RoomSummary): RoomObjectsRequestCandidate[] {
  const requests: RoomObjectsRequestCandidate[] = [];
  const shard = room.shard?.trim();

  if (shard) {
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "GET",
      query: { room: room.name, shard },
    });
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "POST",
      body: { room: room.name, shard },
    });
  }

  requests.push({
    endpoint: "/api/game/room-objects",
    method: "GET",
    query: { room: room.name },
  });
  requests.push({
    endpoint: "/api/game/room-objects",
    method: "POST",
    body: { room: room.name },
  });

  if (!shard || shard.toLowerCase() !== "shard0") {
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "GET",
      query: { room: room.name, shard: "shard0" },
    });
    requests.push({
      endpoint: "/api/game/room-objects",
      method: "POST",
      body: { room: room.name, shard: "shard0" },
    });
  }

  return requests;
}

async function fetchRoomObjectsForThumbnail(
  baseUrl: string,
  token: string,
  username: string,
  room: RoomSummary
): Promise<RoomObjectSummary[] | undefined> {
  const roomObjectsKey = buildRoomObjectsKey(room, baseUrl);
  const cached = ROOM_OBJECTS_CACHE.get(roomObjectsKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  const requests = buildRoomObjectsRequests(room);
  let transientOrUnknownFailure = false;

  for (let attempt = 0; attempt < ROOM_OBJECTS_MAX_ATTEMPTS; attempt += 1) {
    let shouldRetry = false;
    let rateLimited = false;

    for (const candidate of requests) {
      const granted = reserveRoomObjectsRequestSlots(1);
      if (granted <= 0) {
        shouldRetry = true;
        rateLimited = true;
        transientOrUnknownFailure = true;
        break;
      }

      let response: ScreepsResponse;
      try {
        response = await screepsRequest({
          baseUrl,
          endpoint: candidate.endpoint,
          method: candidate.method,
          query: candidate.query,
          body: candidate.body,
          token,
          username,
        });
      } catch {
        shouldRetry = true;
        transientOrUnknownFailure = true;
        continue;
      }

      if (!response.ok) {
        if (isTransientStatus(response.status) || response.status === 0) {
          shouldRetry = true;
          transientOrUnknownFailure = true;
        }
        continue;
      }

      const roomObjects = parseRoomObjectsForThumbnail(room.name, response.data);
      if (roomObjects.length > 0) {
        ROOM_OBJECTS_CACHE.set(roomObjectsKey, roomObjects);
        clearRoomObjectsRetry(baseUrl, room);
        return roomObjects;
      }

      // Some servers return a successful envelope with empty data intermittently.
      shouldRetry = true;
      transientOrUnknownFailure = true;
    }

    if (rateLimited) {
      break;
    }
    if (!shouldRetry || attempt >= ROOM_OBJECTS_MAX_ATTEMPTS - 1) {
      break;
    }

    await wait((attempt + 1) * ROOM_OBJECTS_RETRY_BASE_MS);
  }

  scheduleRoomObjectsRetry(
    baseUrl,
    room,
    transientOrUnknownFailure
      ? ROOM_OBJECTS_RETRY_DELAY_MS
      : ROOM_OBJECTS_NON_TRANSIENT_RETRY_DELAY_MS
  );
  return undefined;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
    worker()
  );
  await Promise.all(workers);
  return output;
}

export async function fetchDashboardRoomObjects(
  session: ScreepsSession,
  rooms: RoomSummary[]
): Promise<Record<string, RoomObjectSummary[]>> {
  if (!rooms.length) {
    return {};
  }

  const now = Date.now();
  const result: Record<string, RoomObjectSummary[]> = {};
  const pendingRooms: RoomSummary[] = [];

  for (const room of rooms) {
    const roomObjectsKey = buildRoomObjectsKey(room, session.baseUrl);
    const cachedObjects = ROOM_OBJECTS_CACHE.get(roomObjectsKey);
    const roomLookupKey = toDashboardRoomKey(room.name, room.shard);

    if (cachedObjects && cachedObjects.length > 0) {
      result[roomLookupKey] = cachedObjects;
      continue;
    }

    if (!canRetryRoomObjects(session.baseUrl, room, now)) {
      continue;
    }

    pendingRooms.push(room);
  }

  if (pendingRooms.length === 0) {
    return result;
  }

  const fetched = await mapWithConcurrency(pendingRooms, 2, async (room) => {
    try {
      const roomObjects = await fetchRoomObjectsForThumbnail(
        session.baseUrl,
        session.token,
        session.username,
        room
      );
      return { room, roomObjects };
    } catch {
      return { room, roomObjects: undefined };
    }
  });

  for (const item of fetched) {
    if (!item.roomObjects || item.roomObjects.length === 0) {
      continue;
    }
    result[toDashboardRoomKey(item.room.name, item.room.shard)] = item.roomObjects;
  }

  return result;
}

async function fetchRoomThumbnails(session: ScreepsSession, rooms: RoomSummary[]): Promise<RoomThumbnail[]> {
  if (!rooms.length) {
    return [];
  }

  const scopeKey = buildRoomThumbnailScopeKey(session);
  // Rotate fetch order between refresh cycles so failed rooms do not starve later entries.
  const start = (() => {
    const current = ROOM_THUMBNAIL_FETCH_CURSOR.get(scopeKey) ?? 0;
    if (rooms.length <= 1) {
      return 0;
    }
    return ((current % rooms.length) + rooms.length) % rooms.length;
  })();
  const rotatedRooms =
    start === 0 ? rooms : [...rooms.slice(start), ...rooms.slice(0, start)];
  if (rooms.length > 1) {
    ROOM_THUMBNAIL_FETCH_CURSOR.set(
      scopeKey,
      (start + Math.max(1, Math.min(ROOM_THUMBNAIL_ROTATE_STEP, rooms.length - 1))) %
        rooms.length
    );
  }

  const now = Date.now();
  const thumbnails = await mapWithConcurrency(rotatedRooms, 4, (room) => {
    const roomKey = buildRoomThumbnailKey(room, session.baseUrl);
    const cachedTerrainRaw =
      ROOM_THUMBNAIL_CACHE.get(roomKey) ??
      getTerrainFromCache(session.baseUrl, room.name, room.shard);
    const cachedTerrain = normalizeTerrainEncoded(cachedTerrainRaw);
    if (!cachedTerrain && cachedTerrainRaw) {
      ROOM_THUMBNAIL_CACHE.delete(roomKey);
    }
    if (cachedTerrain) {
      ROOM_THUMBNAIL_CACHE.set(roomKey, cachedTerrain);
      return Promise.resolve(toTerrainThumbnail(room, cachedTerrain));
    }

    if (!canRetryRoomThumbnail(session.baseUrl, room, now)) {
      return Promise.resolve(toFallbackThumbnail(room));
    }

    return fetchRoomThumbnail(session.baseUrl, session.token, session.username, room);
  });

  const thumbnailByKey = new Map<string, RoomThumbnail>();
  for (const thumbnail of thumbnails) {
    thumbnailByKey.set(buildRoomThumbnailKey(thumbnail, session.baseUrl), thumbnail);
  }

  return rooms.map((room) => {
    const roomKey = buildRoomThumbnailKey(room, session.baseUrl);
    return thumbnailByKey.get(roomKey) ?? toFallbackThumbnail(room);
  });
}

export async function fetchDashboardSnapshot(session: ScreepsSession): Promise<DashboardSnapshot> {
  const requestBatch: ScreepsRequest[] = [
    {
      baseUrl: session.baseUrl,
      endpoint: session.endpointMap.profile.endpoint,
      method: session.endpointMap.profile.method,
      query: session.endpointMap.profile.query,
      body: session.endpointMap.profile.body,
      token: session.token,
      username: session.username,
    },
  ];

  const roomsRequestIndex = session.endpointMap.rooms
    ? requestBatch.push({
        baseUrl: session.baseUrl,
        endpoint: session.endpointMap.rooms.endpoint,
        method: session.endpointMap.rooms.method,
        query: session.endpointMap.rooms.query,
        body: session.endpointMap.rooms.body,
        token: session.token,
        username: session.username,
      }) - 1
    : -1;

  const statsRequestIndex = session.endpointMap.stats
    ? requestBatch.push({
        baseUrl: session.baseUrl,
        endpoint: session.endpointMap.stats.endpoint,
        method: session.endpointMap.stats.method,
        query: session.endpointMap.stats.query,
        body: session.endpointMap.stats.body,
        token: session.token,
        username: session.username,
      }) - 1
    : -1;

  const initialResponses = await screepsBatchRequest(requestBatch, {
    maxConcurrency: Math.min(6, requestBatch.length),
  });

  const profileResponse = initialResponses[0];
  const roomsResponse = roomsRequestIndex >= 0 ? initialResponses[roomsRequestIndex] : undefined;
  const statsResponse = statsRequestIndex >= 0 ? initialResponses[statsRequestIndex] : undefined;

  let safeProfileResponse = profileResponse;
  if (!safeProfileResponse?.ok) {
    const selectedProfileKey = endpointIdentity(
      session.endpointMap.profile.endpoint,
      session.endpointMap.profile.method,
      session.endpointMap.profile.query,
      session.endpointMap.profile.body
    );

    const profileFallbackCandidates = PROFILE_FALLBACK_ENDPOINTS.filter(
      (candidate) =>
        endpointIdentity(candidate.endpoint, candidate.method, candidate.query, candidate.body) !==
        selectedProfileKey
    );

    if (profileFallbackCandidates.length > 0) {
      const fallbackResponses = await screepsBatchRequest(
        profileFallbackCandidates.map((candidate) => ({
          baseUrl: session.baseUrl,
          endpoint: candidate.endpoint,
          method: candidate.method,
          query: candidate.query,
          body: candidate.body,
          token: session.token,
          username: session.username,
        })),
        { maxConcurrency: profileFallbackCandidates.length }
      );

      const firstSuccessfulResponse = fallbackResponses.find((response) => response.ok);
      if (firstSuccessfulResponse) {
        safeProfileResponse = firstSuccessfulResponse;
      }
    }
  }

  if (!safeProfileResponse?.ok) {
    throw new Error(
      `Failed to fetch user data: ${
        safeProfileResponse ? getResponseError(safeProfileResponse) : "request failed"
      }`
    );
  }

  let safeRoomsPayload = roomsResponse?.ok ? roomsResponse.data : undefined;
  let safeStatsPayload = statsResponse?.ok ? statsResponse.data : undefined;
  const profileUserId = extractProfileUserId(safeProfileResponse.data);
  const cachedRooms = getRoomSummariesFromCache(session.baseUrl, session.username);

  const profileHasStatsSignals = hasUsefulStatsPayload(safeProfileResponse.data);
  if (!hasUsefulStatsPayload(safeStatsPayload) && !profileHasStatsSignals) {
    const fallbackStatsPayload = await tryFallbackPayload(
      session,
      STATS_FALLBACK_ENDPOINTS,
      session.endpointMap.stats,
      hasUsefulStatsPayload
    );
    if (fallbackStatsPayload !== undefined) {
      safeStatsPayload = fallbackStatsPayload;
    }
  }

  const profileHasRooms = hasUsefulRoomsPayload(safeProfileResponse.data);
  const shouldFetchRoomsFallback = !hasUsefulRoomsPayload(safeRoomsPayload) && cachedRooms.length === 0;

  if (shouldFetchRoomsFallback && profileUserId) {
    const [roomsWithId] = await screepsBatchRequest(
      [
        {
          baseUrl: session.baseUrl,
          endpoint: "/api/user/rooms",
          method: "GET",
          query: { id: profileUserId },
          token: session.token,
          username: session.username,
        },
      ],
      { maxConcurrency: 1 }
    );
    if (roomsWithId?.ok) {
      safeRoomsPayload = roomsWithId.data;
    }
  }

  if (shouldFetchRoomsFallback && !hasUsefulRoomsPayload(safeRoomsPayload) && !profileHasRooms) {
    const fallbackRoomsPayload = await tryFallbackPayload(
      session,
      buildRoomsFallbackEndpoints(profileUserId),
      session.endpointMap.rooms,
      hasUsefulRoomsPayload
    );
    if (fallbackRoomsPayload !== undefined) {
      safeRoomsPayload = fallbackRoomsPayload;
    }
  }

  const profile = extractProfile(session, safeProfileResponse.data, safeStatsPayload);

  if (profile.cpuUsed === undefined && profile.cpuLimit !== undefined) {
    profile.cpuUsed = 0;
  }
  if (profile.cpuBucket === undefined) {
    profile.cpuBucket = 0;
  }
  if (profile.memLimit === undefined) {
    profile.memLimit = DEFAULT_MEMORY_LIMIT_KB;
  }
  if (profile.memUsed === undefined && profile.memLimit !== undefined) {
    profile.memUsed = 0;
  }
  if (profile.memPercent === undefined) {
    profile.memPercent = toPercent(profile.memUsed, profile.memLimit);
  }

  const shouldTryBadgeAvatar =
    !profile.avatarUrl || /\/api\/user\/avatar/i.test(profile.avatarUrl);

  if (shouldTryBadgeAvatar) {
    const badgeAvatar = await fetchBadgeAvatar(
      session.baseUrl,
      session.token,
      profile.username
    );
    if (badgeAvatar) {
      profile.avatarUrl = badgeAvatar;
    }
  }

  let parsedRooms = extractRooms(safeRoomsPayload, safeProfileResponse.data);
  if (parsedRooms.length === 0 && cachedRooms.length > 0) {
    parsedRooms = cachedRooms;
  }
  if (parsedRooms.length > 0) {
    setRoomSummariesToCache(session.baseUrl, session.username, parsedRooms);
    if (profile.username && profile.username !== session.username) {
      setRoomSummariesToCache(session.baseUrl, profile.username, parsedRooms);
    }
  }

  const rooms = await hydrateRoomLevelsFromMapStats(session, parsedRooms);
  const roomThumbnails = await fetchRoomThumbnails(session, rooms);

  return {
    fetchedAt: new Date().toISOString(),
    profile,
    rooms,
    roomThumbnails,
  };
}
