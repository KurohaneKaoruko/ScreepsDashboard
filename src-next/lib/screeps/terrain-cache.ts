import { normalizeBaseUrl } from "./request";

const TERRAIN_CACHE_STORAGE_KEY = "screeps-dashboard-terrain-cache-v1";
const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/i;
const SHARD_PATTERN = /^shard\d+$/i;
const MAX_TERRAIN_CACHE_ENTRIES = 1200;

interface TerrainCacheEntry {
  encoded: string;
  updatedAt: number;
}

const memoryTerrainCache = new Map<string, TerrainCacheEntry>();
let terrainCacheHydrated = false;
let persistTimer: number | undefined;

function normalizeRoomName(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  if (!ROOM_NAME_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeShard(shard: string | undefined): string | undefined {
  if (!shard) {
    return undefined;
  }
  const normalized = shard.trim().toLowerCase();
  return SHARD_PATTERN.test(normalized) ? normalized : undefined;
}

function buildTerrainCacheKey(baseUrl: string, roomName: string, shard?: string): string | undefined {
  const normalizedRoom = normalizeRoomName(roomName);
  if (!normalizedRoom) {
    return undefined;
  }

  const normalizedBase = normalizeBaseUrl(baseUrl).toLowerCase();
  const normalizedShard = normalizeShard(shard) ?? "unknown";
  return `${normalizedBase}|${normalizedShard}|${normalizedRoom}`;
}

function trimCacheEntries(): void {
  if (memoryTerrainCache.size <= MAX_TERRAIN_CACHE_ENTRIES) {
    return;
  }

  const overflow = memoryTerrainCache.size - MAX_TERRAIN_CACHE_ENTRIES;
  const oldestEntries = [...memoryTerrainCache.entries()]
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(0, overflow);

  for (const [key] of oldestEntries) {
    memoryTerrainCache.delete(key);
  }
}

function hydrateTerrainCache(): void {
  if (terrainCacheHydrated || typeof window === "undefined") {
    return;
  }
  terrainCacheHydrated = true;

  try {
    const raw = window.localStorage.getItem(TERRAIN_CACHE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== "string") {
        continue;
      }

      const entryRecord = typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
      if (!entryRecord) {
        continue;
      }

      const encoded = typeof entryRecord.encoded === "string" ? entryRecord.encoded.trim() : "";
      const updatedAt =
        typeof entryRecord.updatedAt === "number" && Number.isFinite(entryRecord.updatedAt)
          ? entryRecord.updatedAt
          : Date.now();
      if (!encoded) {
        continue;
      }

      memoryTerrainCache.set(key, {
        encoded,
        updatedAt,
      });
    }
    trimCacheEntries();
  } catch {
    // Ignore storage corruption and keep running with in-memory cache only.
  }
}

function persistTerrainCacheNow(): void {
  if (typeof window === "undefined") {
    return;
  }

  trimCacheEntries();
  const payload: Record<string, TerrainCacheEntry> = {};
  for (const [key, value] of memoryTerrainCache.entries()) {
    payload[key] = value;
  }

  try {
    window.localStorage.setItem(TERRAIN_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota failures and keep using in-memory cache.
  }
}

function schedulePersistTerrainCache(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (persistTimer !== undefined) {
    return;
  }

  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    persistTerrainCacheNow();
  }, 220);
}

export function getTerrainFromCache(
  baseUrl: string,
  roomName: string,
  shard?: string
): string | undefined {
  hydrateTerrainCache();

  const exactKey = buildTerrainCacheKey(baseUrl, roomName, shard);
  if (exactKey) {
    const cached = memoryTerrainCache.get(exactKey);
    if (cached) {
      return cached.encoded;
    }
  }

  if (shard) {
    const shardlessKey = buildTerrainCacheKey(baseUrl, roomName);
    if (!shardlessKey) {
      return undefined;
    }
    return memoryTerrainCache.get(shardlessKey)?.encoded;
  }

  return undefined;
}

export function setTerrainToCache(
  baseUrl: string,
  roomName: string,
  encoded: string,
  shard?: string
): void {
  const normalizedEncoded = encoded.trim();
  if (!normalizedEncoded) {
    return;
  }

  hydrateTerrainCache();
  const key = buildTerrainCacheKey(baseUrl, roomName, shard);
  if (!key) {
    return;
  }

  memoryTerrainCache.set(key, {
    encoded: normalizedEncoded,
    updatedAt: Date.now(),
  });
  trimCacheEntries();
  schedulePersistTerrainCache();
}
