import { normalizeBaseUrl } from "./request";
import type { RoomSummary } from "./types";

const ROOM_SUMMARY_CACHE_STORAGE_KEY = "screeps-dashboard-room-summary-cache-v1";
const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/i;
const SHARD_PATTERN = /^shard\d+$/i;
const MAX_USERS_IN_CACHE = 24;

interface RoomSummaryCacheEntry {
  updatedAt: number;
  rooms: RoomSummary[];
}

const roomSummaryCacheMemory = new Map<string, RoomSummaryCacheEntry>();
let roomSummaryCacheHydrated = false;
let persistTimer: number | undefined;

function buildUserCacheKey(baseUrl: string, username: string): string {
  return `${normalizeBaseUrl(baseUrl).toLowerCase()}|${username.trim().toLowerCase()}`;
}

function normalizeCachedRoom(value: unknown): RoomSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nameValue = typeof record.name === "string" ? record.name.trim().toUpperCase() : "";
  if (!ROOM_NAME_PATTERN.test(nameValue)) {
    return null;
  }

  const shardRaw = typeof record.shard === "string" ? record.shard.trim().toLowerCase() : "";
  const shard = SHARD_PATTERN.test(shardRaw) ? shardRaw : undefined;
  const owner = typeof record.owner === "string" ? record.owner.trim() : undefined;

  const level =
    typeof record.level === "number" && Number.isFinite(record.level)
      ? Math.max(0, Math.floor(record.level))
      : undefined;
  const energyAvailable =
    typeof record.energyAvailable === "number" && Number.isFinite(record.energyAvailable)
      ? record.energyAvailable
      : undefined;
  const energyCapacity =
    typeof record.energyCapacity === "number" && Number.isFinite(record.energyCapacity)
      ? record.energyCapacity
      : undefined;

  return {
    name: nameValue,
    shard,
    owner,
    level,
    energyAvailable,
    energyCapacity,
  };
}

function normalizeCachedRooms(value: unknown): RoomSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const roomByName = new Map<string, RoomSummary>();
  for (const item of value) {
    const room = normalizeCachedRoom(item);
    if (!room) {
      continue;
    }
    roomByName.set(room.name, room);
  }

  return [...roomByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function trimUserCacheEntries(): void {
  if (roomSummaryCacheMemory.size <= MAX_USERS_IN_CACHE) {
    return;
  }

  const overflow = roomSummaryCacheMemory.size - MAX_USERS_IN_CACHE;
  const oldestKeys = [...roomSummaryCacheMemory.entries()]
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(0, overflow)
    .map(([key]) => key);

  for (const key of oldestKeys) {
    roomSummaryCacheMemory.delete(key);
  }
}

function hydrateRoomSummaryCache(): void {
  if (roomSummaryCacheHydrated || typeof window === "undefined") {
    return;
  }
  roomSummaryCacheHydrated = true;

  try {
    const raw = window.localStorage.getItem(ROOM_SUMMARY_CACHE_STORAGE_KEY);
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

      const rooms = normalizeCachedRooms(entryRecord.rooms);
      if (!rooms.length) {
        continue;
      }

      const updatedAt =
        typeof entryRecord.updatedAt === "number" && Number.isFinite(entryRecord.updatedAt)
          ? entryRecord.updatedAt
          : Date.now();
      roomSummaryCacheMemory.set(key, {
        updatedAt,
        rooms,
      });
    }
    trimUserCacheEntries();
  } catch {
    // Ignore cache corruption.
  }
}

function persistRoomSummaryCacheNow(): void {
  if (typeof window === "undefined") {
    return;
  }

  trimUserCacheEntries();
  const payload: Record<string, RoomSummaryCacheEntry> = {};
  for (const [key, entry] of roomSummaryCacheMemory.entries()) {
    payload[key] = entry;
  }

  try {
    window.localStorage.setItem(ROOM_SUMMARY_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota errors.
  }
}

function schedulePersistRoomSummaryCache(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (persistTimer !== undefined) {
    return;
  }

  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    persistRoomSummaryCacheNow();
  }, 220);
}

export function getRoomSummariesFromCache(
  baseUrl: string,
  username: string
): RoomSummary[] {
  hydrateRoomSummaryCache();

  if (!username.trim()) {
    return [];
  }

  const key = buildUserCacheKey(baseUrl, username);
  const entry = roomSummaryCacheMemory.get(key);
  if (!entry) {
    return [];
  }

  return entry.rooms.map((room) => ({ ...room }));
}

export function setRoomSummariesToCache(
  baseUrl: string,
  username: string,
  rooms: RoomSummary[]
): void {
  if (!username.trim() || rooms.length === 0) {
    return;
  }

  const normalizedRooms = normalizeCachedRooms(rooms);
  if (!normalizedRooms.length) {
    return;
  }

  hydrateRoomSummaryCache();
  const key = buildUserCacheKey(baseUrl, username);
  roomSummaryCacheMemory.set(key, {
    updatedAt: Date.now(),
    rooms: normalizedRooms,
  });
  trimUserCacheEntries();
  schedulePersistRoomSummaryCache();
}
