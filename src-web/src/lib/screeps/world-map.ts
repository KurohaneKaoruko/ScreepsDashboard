import { normalizeBaseUrl, screepsBatchRequest } from "./request";
import { extractTerrain, extractOfficialRendererObjects, extractOfficialRendererUsers } from "./room-detail";
import { getTerrainFromCache, setTerrainToCache } from "./terrain-cache";
import type {
  OfficialRoomObjectRecord,
  OfficialRoomUserRecord,
  QueryParams,
  ScreepsMethod,
  WorldRoomStat,
} from "./types";

export type { WorldRoomStat } from "./types";

/**
 * World map (a.k.a. room map) helpers.
 *
 * The world is a plain grid of rooms addressed as `E/W<number>N/S<number>`.
 * Room statistics come from `POST /api/game/map-stats`, which is the only
 * endpoint both official and private servers agree on for bulk room data.
 *
 * Everything here is intentionally tolerant: official servers, community
 * drivers and private servers all wrap the same payload slightly differently.
 */

const WORLD_ROOM_PATTERN = /^([WE])(\d+)([NS])(\d+)$/i;

/** Private servers cap the room list per request; 40 matches the dashboard usage. */
export const WORLD_MAP_STATS_BATCH_SIZE = 40;

/**
 * The Screeps world is laid out as 10x10 sector blocks; fetching whole sectors
 * keeps coverage contiguous and makes the cache meaningfully reusable while
 * panning, instead of requesting thin camera-shaped slices.
 */
export const WORLD_SECTOR_SIZE = 10;

/** Highway rooms are the sector borders: every 10th row/column through the origin. */
export const WORLD_HIGHWAY_PERIOD = WORLD_SECTOR_SIZE;

/** A room is a highway room when it sits on a sector border. */
export function isHighwayRoom(coord: WorldRoomCoord): boolean {
  return (
    ((coord.x % WORLD_HIGHWAY_PERIOD) + WORLD_HIGHWAY_PERIOD) % WORLD_HIGHWAY_PERIOD === 0 ||
    ((coord.y % WORLD_HIGHWAY_PERIOD) + WORLD_HIGHWAY_PERIOD) % WORLD_HIGHWAY_PERIOD === 0
  );
}

/** Sector index (10x10 block) that contains a room, e.g. E0N0 -> { sx: 0, sy: 0 }. */
export function worldSectorOf(coord: WorldRoomCoord): { sx: number; sy: number } {
  return {
    sx: Math.floor(coord.x / WORLD_SECTOR_SIZE),
    sy: Math.floor(coord.y / WORLD_SECTOR_SIZE),
  };
}

/** Bounded in-memory cache so panning back over visited rooms is instant. */
const WORLD_MAP_CACHE_LIMIT = 24_000;
const WORLD_MAP_CACHE_TTL_MS = 10 * 60 * 1000;

export interface WorldRoomCoord {
  x: number;
  y: number;
}

/** Top-left (western-most, southern-most) coordinate of a sector block. */
export interface WorldSectorOrigin {
  x: number;
  y: number;
}

interface CachedWorldRoom extends WorldRoomStat {
  updatedAt: number;
}

const worldRoomCache = new Map<string, CachedWorldRoom>();

export function parseWorldRoomName(value: unknown): WorldRoomCoord | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().toUpperCase().match(WORLD_ROOM_PATTERN);
  if (!match) {
    return null;
  }

  const [, horizontal, horizontalNumber, vertical, verticalNumber] = match;
  const x = (horizontal === "W" ? -1 : 1) * Number(horizontalNumber);
  const y = (vertical === "N" ? 1 : -1) * Number(verticalNumber);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }
  return { x, y };
}

export function formatWorldRoomName(coord: WorldRoomCoord): string {
  const horizontal = coord.x < 0 ? `W${-coord.x}` : `E${coord.x}`;
  const vertical = coord.y < 0 ? `S${-coord.y}` : `N${coord.y}`;
  return `${horizontal}${vertical}`;
}

export function normalizeWorldRoomName(value: unknown): string | undefined {
  const coord = parseWorldRoomName(value);
  return coord ? formatWorldRoomName(coord) : undefined;
}

function worldRoomCacheKey(baseUrl: string, shard: string | undefined, roomName: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl).toLowerCase();
  const normalizedShard = shard?.trim().toLowerCase() || "unknown";
  return `${normalizedBase}|${normalizedShard}|${roomName}`;
}

function readCachedWorldRooms(
  baseUrl: string,
  shard: string | undefined,
  roomNames: string[]
): Map<string, WorldRoomStat> {
  const output = new Map<string, WorldRoomStat>();
  const now = Date.now();

  for (const roomName of roomNames) {
    const key = worldRoomCacheKey(baseUrl, shard, roomName);
    const cached = worldRoomCache.get(key);
    if (!cached) {
      continue;
    }
    if (now - cached.updatedAt > WORLD_MAP_CACHE_TTL_MS) {
      worldRoomCache.delete(key);
      continue;
    }
    const { updatedAt: _updatedAt, ...stat } = cached;
    output.set(roomName, stat);
  }

  return output;
}

function writeCachedWorldRooms(
  baseUrl: string,
  shard: string | undefined,
  rooms: readonly WorldRoomStat[]
): void {
  const now = Date.now();
  for (const room of rooms) {
    worldRoomCache.set(worldRoomCacheKey(baseUrl, shard, room.room), {
      ...room,
      updatedAt: now,
    });
  }

  if (worldRoomCache.size <= WORLD_MAP_CACHE_LIMIT) {
    return;
  }

  const overflow = worldRoomCache.size - WORLD_MAP_CACHE_LIMIT;
  const oldestKeys = [...worldRoomCache.entries()]
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) {
    worldRoomCache.delete(key);
  }
}

export function clearWorldMapRoomCache(): void {
  worldRoomCache.clear();
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
  if (typeof value === "string" && value.trim().length > 0) {
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

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

function toLevel(value: unknown): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  const rounded = Math.round(parsed);
  if (!Number.isInteger(rounded) || rounded < 0 || rounded > 8) {
    return undefined;
  }
  return rounded;
}

/**
 * Collects every object that is keyed by room names (`{ W0N0: {...}, E1N1: {...} }`),
 * which is how `map-stats` exposes per-room records on every known server.
 */
function collectRoomKeyedRecords(
  value: unknown,
  sink: Array<Record<string, unknown>>,
  depth: number,
  visited: WeakSet<object>
): void {
  if (depth > 6 || value === null || typeof value !== "object" || sink.length > 32) {
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRoomKeyedRecords(item, sink, depth + 1, visited);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const hasRoomKeys = Object.keys(record).some((key) => parseWorldRoomName(key) !== null);
  if (hasRoomKeys) {
    sink.push(record);
  }

  for (const nested of Object.values(record)) {
    collectRoomKeyedRecords(nested, sink, depth + 1, visited);
  }
}

function collectRoomFieldedRecords(
  value: unknown,
  sink: Array<Record<string, unknown>>,
  depth: number,
  visited: WeakSet<object>
): void {
  if (depth > 6 || value === null || typeof value !== "object" || sink.length > 400) {
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRoomFieldedRecords(item, sink, depth + 1, visited);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  if (normalizeWorldRoomName(firstString([record.room, record.roomName, record.name]))) {
    sink.push(record);
  }

  for (const nested of Object.values(record)) {
    collectRoomFieldedRecords(nested, sink, depth + 1, visited);
  }
}

/** Builds an id -> username directory out of whatever `users` payload the server sent. */
export function extractUserDirectory(payload: unknown): Record<string, string> {
  const directory: Record<string, string> = {};
  const visited = new WeakSet<object>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const id = firstString([record._id, record.id, record.userId, record.user]);
    const username = firstString([record.username, record.name]);
    if (id && username) {
      directory[id] = username;
    }

    for (const [key, nested] of Object.entries(record)) {
      if (nested !== null && typeof nested === "object") {
        visit(nested, depth + 1);
        continue;
      }
      const nestedUsername = asString(nested);
      if (nestedUsername && (key === "username" || key === "name")) {
        directory[key] = nestedUsername;
      }
    }
  };

  visit(payload, 0);
  return directory;
}

function resolveOwnerFromRecord(
  record: Record<string, unknown>,
  userDirectory: Record<string, string>
): { owner?: string; ownerId?: string } {
  const ownerRecord = asRecord(record.owner) ?? {};
  const controllerRecord = asRecord(record.controller) ?? {};
  const own0 = asRecord(record.own0) ?? {};
  const owner0 = asRecord(record.owner0) ?? {};
  const own = asRecord(record.own) ?? {};
  // Some payload flavours carry the owner as a plain string (a user id or a
  // username) instead of a nested `{ user }` object.
  const ownerFlat = firstString([record.owner, record.own]);

  const rawId = firstString([
    record.user,
    record.userId,
    ownerRecord.user,
    ownerRecord._id,
    ownerRecord.id,
    controllerRecord.user,
    controllerRecord._id,
    own0.user,
    owner0.user,
    own.user,
    record.ownerId,
    ownerFlat,
  ]);
  const rawName = firstString([
    ownerRecord.username,
    ownerRecord.name,
    controllerRecord.username,
    controllerRecord.owner,
    own0.username,
    owner0.username,
    own.username,
    record.username,
    record.ownerName,
  ]);

  const ownerId = rawId;
  const owner =
    rawName ??
    (rawId ? userDirectory[rawId] : undefined) ??
    (rawId ? rawId : undefined);

  return {
    owner: owner ?? undefined,
    ownerId,
  };
}

function toWorldRoomStat(
  roomName: string,
  record: Record<string, unknown>,
  userDirectory: Record<string, string>
): WorldRoomStat | null {
  const coord = parseWorldRoomName(roomName);
  if (!coord) {
    return null;
  }

  const { owner, ownerId } = resolveOwnerFromRecord(record, userDirectory);
  const controllerRecord = asRecord(record.controller) ?? {};
  const own0 = asRecord(record.own0) ?? {};
  const owner0 = asRecord(record.owner0) ?? {};
  const own = asRecord(record.own) ?? {};
  const level = toLevel(
    firstNumber([
      record.level,
      record.rcl,
      record.controllerLevel,
      record.cl,
      controllerRecord.level,
      own0.level,
      owner0.level,
      own.level,
      asRecord(record.stats)?.level,
    ])
  );
  const novice = asBoolean(firstDefined(record.novice, record.noviceArea, record.noviceZone));
  const respawnArea = asBoolean(firstDefined(record.respawnArea, record.respawn, record.respawnZone));

  const safeModeValue = firstNumber([
    record.safeMode,
    controllerRecord.safeMode,
    own0.safeMode,
    owner0.safeMode,
  ]);
  const safeMode = safeModeValue !== undefined && safeModeValue > 0 ? true : undefined;

  if (!owner && level === undefined && !novice && !respawnArea) {
    return null;
  }

  return {
    room: roomName,
    x: coord.x,
    y: coord.y,
    owner,
    ownerId,
    level,
    novice,
    respawnArea,
    safeMode,
  };
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/** Parses a `map-stats` payload into room records, tolerating all known shapes. */
export function extractWorldRoomStats(
  payload: unknown,
  userDirectory: Record<string, string> = {}
): { rooms: WorldRoomStat[]; users: Record<string, string> } {
  const users = Object.keys(userDirectory).length > 0 ? userDirectory : extractUserDirectory(payload);
  const stats: WorldRoomStat[] = [];
  const seen = new Set<string>();

  const push = (roomName: string, record: Record<string, unknown>): void => {
    if (seen.has(roomName)) {
      return;
    }
    const stat = toWorldRoomStat(roomName, record, users);
    if (!stat) {
      return;
    }
    seen.add(roomName);
    stats.push(stat);
  };

  const keyedRecords: Array<Record<string, unknown>> = [];
  collectRoomKeyedRecords(payload, keyedRecords, 0, new WeakSet<object>());

  // Prefer the keyed record that carries the most rooms (usually `stats.rooms`).
  keyedRecords.sort((left, right) => roomKeyCount(right) - roomKeyCount(left));
  for (const record of keyedRecords) {
    for (const [key, value] of Object.entries(record)) {
      const roomName = normalizeWorldRoomName(key);
      if (!roomName) {
        continue;
      }
      push(roomName, asRecord(value) ?? {});
    }
  }

  if (stats.length > 0) {
    return { rooms: stats, users };
  }

  const fieldedRecords: Array<Record<string, unknown>> = [];
  collectRoomFieldedRecords(payload, fieldedRecords, 0, new WeakSet<object>());
  for (const record of fieldedRecords) {
    const roomName = normalizeWorldRoomName(firstString([record.room, record.roomName, record.name]));
    if (!roomName) {
      continue;
    }
    push(roomName, record);
  }

  return { rooms: stats, users };
}

function roomKeyCount(record: Record<string, unknown>): number {
  let count = 0;
  for (const key of Object.keys(record)) {
    if (parseWorldRoomName(key) !== null) {
      count += 1;
    }
  }
  return count;
}

export function extractGameTimeFromPayload(payload: unknown): number | undefined {
  const queue: unknown[] = [payload];
  let depth = 0;

  while (queue.length > 0 && depth < 400) {
    const current = queue.shift();
    depth += 1;
    const record = asRecord(current);
    if (!record) {
      continue;
    }
    const gameTime = firstNumber([record.gameTime, record.time, record.tick]);
    if (gameTime !== undefined && gameTime > 0) {
      return Math.floor(gameTime);
    }
    for (const nested of Object.values(record)) {
      if (nested !== null && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }

  return undefined;
}

interface WorldMapStatsRequestShape {
  method: ScreepsMethod;
  query?: QueryParams;
  body?: unknown;
}

function buildStatsRequestShapes(
  rooms: string[],
  statName: string,
  shard?: string
): WorldMapStatsRequestShape[] {
  const shapes: WorldMapStatsRequestShape[] = [];

  if (shard) {
    shapes.push({ method: "POST", body: { rooms, statName, shard } });
    shapes.push({ method: "GET", query: { statName, rooms: rooms.join(","), shard } });
  }
  shapes.push({ method: "POST", body: { rooms, statName } });
  shapes.push({ method: "GET", query: { statName, rooms: rooms.join(",") } });

  return shapes;
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

/**
 * Auth context for world map requests. World statistics are public data, so a
 * token is optional: guest sessions and anonymous visitors work as long as a
 * server URL is known.
 */
export interface WorldMapAuthContext {
  baseUrl: string;
  token?: string | null;
  username?: string | null;
}

export interface WorldMapFetchOptions extends WorldMapAuthContext {
  rooms: string[];
  shard?: string;
  /** Set to false to bypass the in-memory cache (used by manual refresh). */
  useCache?: boolean;
  maxConcurrency?: number;
}

export interface WorldMapFetchResult {
  rooms: WorldRoomStat[];
  users: Record<string, string>;
  gameTime?: number;
  requested: number;
  resolved: number;
  /**
   * True when at least one request produced a well-formed `map-stats` answer.
   * An empty region legitimately answers with zero owned rooms, so callers
   * must not confuse that with a failing endpoint.
   */
  ok: boolean;
}

/** Heuristic check that a payload really is a `map-stats` response, empty or not. */
function isMapStatsPayload(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }
  if (record.ok === true || (asNumber(record.ok) ?? 0) > 0) {
    return true;
  }
  return (
    record.stats !== undefined ||
    record.rooms !== undefined ||
    record.gameTime !== undefined ||
    record.users !== undefined
  );
}

/**
 * Fetches room statistics for a list of rooms.
 *
 * The first batch doubles as an endpoint probe: the first request shape that
 * returns usable room records is reused for the remaining batches so a single
 * pan/zoom does not multiply every request by the number of fallbacks.
 */
export async function fetchWorldMapRooms(options: WorldMapFetchOptions): Promise<WorldMapFetchResult> {
  const baseUrl = options.baseUrl;
  const shard = options.shard;
  const token = options.token?.trim() ? options.token : undefined;
  const username = options.username?.trim() ? options.username : undefined;
  const requestedRooms = [
    ...new Set(options.rooms.map((room) => normalizeWorldRoomName(room) ?? "")),
  ].filter((room) => room.length > 0);

  if (requestedRooms.length === 0) {
    return { rooms: [], users: {}, requested: requestedRooms.length, resolved: 0, ok: true };
  }

  const useCache = options.useCache ?? true;
  const cached = useCache ? readCachedWorldRooms(baseUrl, shard, requestedRooms) : new Map<string, WorldRoomStat>();
  const missing = requestedRooms.filter((room) => !cached.has(room));

  const rooms: WorldRoomStat[] = [...cached.values()];
  const users: Record<string, string> = {};
  let gameTime: number | undefined;
  let ok = missing.length === 0;

  if (missing.length > 0) {
    const chunks = splitIntoChunks(missing, WORLD_MAP_STATS_BATCH_SIZE);
    const [firstChunk, ...restChunks] = chunks;
    let shape: WorldMapStatsRequestShape | undefined;

    if (firstChunk) {
      const shapes = buildStatsRequestShapes(firstChunk, "owner0", shard);
      const responses = await screepsBatchRequest(
        shapes.map((candidate) => ({
          baseUrl,
          endpoint: "/api/game/map-stats",
          method: candidate.method,
          query: candidate.query,
          body: candidate.body,
          token,
          username,
        })),
        { maxConcurrency: Math.min(6, shapes.length) }
      );

      for (let index = 0; index < shapes.length; index += 1) {
        const response = responses[index];
        if (!response?.ok) {
          continue;
        }
        const parsed = extractWorldRoomStats(response.data);
        // An owned-room query legitimately returns nothing for unowned regions,
        // so a well-formed payload counts as a successful probe.
        if (parsed.rooms.length === 0 && !isMapStatsPayload(response.data)) {
          continue;
        }
        shape = shapes[index];
        ok = true;
        for (const room of parsed.rooms) {
          rooms.push(room);
        }
        Object.assign(users, parsed.users);
        gameTime = extractGameTimeFromPayload(response.data) ?? gameTime;
        break;
      }
    }

    if (shape && restChunks.length > 0) {
      const concurrency = options.maxConcurrency ?? 6;
      const batchResponses = await screepsBatchRequest(
        restChunks.map((chunk) => ({
          baseUrl,
          endpoint: "/api/game/map-stats",
          method: shape?.method ?? "POST",
          query: shape?.query
            ? { ...shape.query, rooms: chunk.join(",") }
            : undefined,
          body: shape?.body
            ? { ...(shape.body as Record<string, unknown>), rooms: chunk }
            : undefined,
          token,
          username,
        })),
        { maxConcurrency: Math.min(concurrency, restChunks.length) }
      );

      for (const response of batchResponses) {
        if (!response?.ok) {
          continue;
        }
        const parsed = extractWorldRoomStats(response.data);
        if (parsed.rooms.length === 0 && !isMapStatsPayload(response.data)) {
          continue;
        }
        ok = true;
        for (const room of parsed.rooms) {
          rooms.push(room);
        }
        Object.assign(users, parsed.users);
        gameTime = extractGameTimeFromPayload(response.data) ?? gameTime;
      }
    }
  }

  if (useCache && rooms.length > 0) {
    writeCachedWorldRooms(baseUrl, shard, rooms);
  }

  return {
    rooms,
    users,
    gameTime,
    requested: requestedRooms.length,
    resolved: rooms.length,
    ok,
  };
}

/** Extracts room names out of a `/api/user/rooms`-style payload. */
export function extractWorldRoomNames(payload: unknown): string[] {
  const names = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null) {
      return;
    }
    // `{ rooms: ["W8N3", "W9N3"] }` is the official shape, so strings have to be
    // matched wherever they appear, not only as object values.
    if (typeof value === "string") {
      const roomName = normalizeWorldRoomName(value);
      if (roomName) {
        names.add(roomName);
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      // `{ W8N3: {...} }` style payloads key the data by room name.
      const keyRoomName = normalizeWorldRoomName(key);
      if (keyRoomName) {
        names.add(keyRoomName);
      }
      visit(nested, depth + 1);
    }
  };

  visit(payload, 0);
  return [...names];
}

/** Fetches the signed-in user's own rooms so the map can highlight them. */
export async function fetchWorldMapOwnRooms(auth: WorldMapAuthContext): Promise<string[]> {  const candidates: Array<{ method: ScreepsMethod; query?: QueryParams }> = [
    { method: "GET" },
    { method: "POST" },
  ];

  const token = auth.token?.trim() ? auth.token : undefined;
  const username = auth.username?.trim() ? auth.username : undefined;
  const responses = await screepsBatchRequest(
    candidates.map((candidate) => ({
      baseUrl: auth.baseUrl,
      endpoint: "/api/user/rooms",
      method: candidate.method,
      query: candidate.query,
      body: candidate.method === "GET" ? undefined : {},
      token,
      username,
    })),
    { maxConcurrency: candidates.length }
  );

  for (const response of responses) {
    if (!response?.ok) {
      continue;
    }
    const roomNames = extractWorldRoomNames(response.data);
    if (roomNames.length > 0) {
      return roomNames;
    }
  }

  return [];
}

/* -------------------------------------------------------------------------- *
 * Room scenes (official renderer previews)
 * -------------------------------------------------------------------------- */

/**
 * Everything the official renderer needs to draw one room: its terrain plus the
 * live game objects. Produced per room by {@link fetchWorldRoomScene} and fed to
 * the offscreen renderer by the world map, so a map tile can show the real room
 * instead of a flat owner colour.
 */
export interface WorldRoomScene {
  room: string;
  terrainEncoded?: string;
  officialObjects: OfficialRoomObjectRecord[];
  officialUsers?: Record<string, OfficialRoomUserRecord>;
  gameTime?: number;
}

/** Terrain request shapes, most specific (shard) first, mirroring room detail. */
function buildSceneTerrainQueries(roomName: string, shard?: string): QueryParams[] {
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

/** Object request shapes, most specific (shard) first, mirroring room detail. */
function buildSceneObjectRequests(
  roomName: string,
  shard?: string
): Array<{ method: ScreepsMethod; query?: QueryParams; body?: unknown }> {
  const requests: Array<{ method: ScreepsMethod; query?: QueryParams; body?: unknown }> = [];
  if (shard) {
    requests.push({ method: "GET", query: { room: roomName, shard } });
    requests.push({ method: "POST", body: { room: roomName, shard } });
  }
  requests.push({ method: "GET", query: { room: roomName } });
  requests.push({ method: "POST", body: { room: roomName } });
  if (!shard || shard !== "shard0") {
    requests.push({ method: "GET", query: { room: roomName, shard: "shard0" } });
    requests.push({ method: "POST", body: { room: roomName, shard: "shard0" } });
  }
  return requests;
}

async function fetchSceneTerrain(
  auth: WorldMapAuthContext,
  roomName: string,
  shard: string | undefined,
  token: string | undefined
): Promise<string | undefined> {
  const cached = getTerrainFromCache(auth.baseUrl, roomName, shard);
  if (cached) {
    return cached;
  }

  const queries = buildSceneTerrainQueries(roomName, shard);
  const responses = await screepsBatchRequest(
    queries.map((query) => ({
      baseUrl: auth.baseUrl,
      endpoint: "/api/game/room-terrain",
      method: "GET" as ScreepsMethod,
      query,
      token,
    })),
    { maxConcurrency: queries.length }
  );

  for (const response of responses) {
    if (!response?.ok) {
      continue;
    }
    const terrain = extractTerrain(response.data);
    if (terrain) {
      setTerrainToCache(auth.baseUrl, roomName, terrain, shard);
      return terrain;
    }
  }

  return undefined;
}

/**
 * Fetches one room's terrain and objects for an official-renderer preview.
 *
 * Terrain is public, so guests get real terrain tiles. Room objects need a
 * token; without one the map still renders terrain on its own.
 */
export async function fetchWorldRoomScene(
  auth: WorldMapAuthContext,
  roomName: string,
  shard?: string
): Promise<WorldRoomScene | null> {
  const normalized = normalizeWorldRoomName(roomName);
  if (!normalized) {
    return null;
  }

  const token = auth.token?.trim() ? auth.token : undefined;
  const username = auth.username?.trim() ? auth.username : undefined;
  const normalizedShard = shard?.trim() ? shard.trim() : undefined;
  const scene: WorldRoomScene = { room: normalized, officialObjects: [] };

  const terrain = await fetchSceneTerrain(auth, normalized, normalizedShard, token);
  if (terrain) {
    scene.terrainEncoded = terrain;
  }

  if (token) {
    const requests = buildSceneObjectRequests(normalized, normalizedShard);
    const responses = await screepsBatchRequest(
      requests.map((request) => ({
        baseUrl: auth.baseUrl,
        endpoint: "/api/game/room-objects",
        method: request.method,
        query: request.query,
        body: request.body,
        token,
        username,
      })),
      { maxConcurrency: Math.min(4, requests.length) }
    );

    for (const response of responses) {
      if (!response?.ok) {
        continue;
      }
      const parsedObjects = extractOfficialRendererObjects(response.data);
      if (parsedObjects.length > 0) {
        scene.officialObjects = parsedObjects;
      }
      const users = extractOfficialRendererUsers(response.data);
      if (users) {
        scene.officialUsers = users;
      }
      const gameTime = extractGameTimeFromPayload(response.data);
      if (gameTime !== undefined) {
        scene.gameTime = gameTime;
      }
      if (scene.officialObjects.length > 0) {
        break;
      }
    }
  }

  if (!scene.terrainEncoded && scene.officialObjects.length === 0) {
    return null;
  }
  return scene;
}
