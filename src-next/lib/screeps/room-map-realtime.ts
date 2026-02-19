import { type ScreepsRealtimeEvent } from "./realtime-client";

export type RoomMapPoint = readonly [number, number];

export interface RoomMapOverlay {
  roomName: string;
  shard?: string;
  walls: RoomMapPoint[];
  roads: RoomMapPoint[];
  powerBanks: RoomMapPoint[];
  portals: RoomMapPoint[];
  sources: RoomMapPoint[];
  controllers: RoomMapPoint[];
  minerals: RoomMapPoint[];
  keepers: RoomMapPoint[];
  userPoints: RoomMapPoint[];
  updatedAt: string;
}

const ROOM_NAME_PATTERN = /[WE]\d+[NS]\d+/i;
const SHARD_NAME_PATTERN = /shard\d+/i;
const DEFAULT_SHARDS = ["shard0", "shard1", "shard2", "shard3"] as const;
const USER_ID_PATTERN = /^[0-9a-f]{24}$/i;

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

function parseRoomName(value: string): string | undefined {
  const match = value.toUpperCase().match(ROOM_NAME_PATTERN);
  return match?.[0];
}

function parseShard(value: string): string | undefined {
  const match = value.toLowerCase().match(SHARD_NAME_PATTERN);
  return match?.[0];
}

function parsePoint(value: unknown): RoomMapPoint | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const x = asNumber(value[0]);
  const y = asNumber(value[1]);
  if (x === undefined || y === undefined) {
    return null;
  }
  if (x < 0 || x > 49 || y < 0 || y > 49) {
    return null;
  }
  return [x, y];
}

function parsePoints(value: unknown): RoomMapPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: RoomMapPoint[] = [];
  for (const item of value) {
    const point = parsePoint(item);
    if (point) {
      output.push(point);
    }
  }
  return output;
}

export function buildRoomMapRealtimeChannels(
  roomName: string,
  shard?: string
): string[] {
  const normalizedRoom = parseRoomName(roomName.trim()) ?? roomName.trim().toUpperCase();
  if (!normalizedRoom) {
    return [];
  }

  const channelSet = new Set<string>();
  const shards = shard ? [shard.toLowerCase()] : [...DEFAULT_SHARDS];

  channelSet.add(`roomMap2:${normalizedRoom}`);
  for (const shardName of shards) {
    channelSet.add(`roomMap2:${shardName}/${normalizedRoom}`);
  }

  return [...channelSet];
}

export function toRoomMapOverlayKey(roomName: string, shard?: string): string {
  const normalizedRoom = roomName.trim().toUpperCase();
  const normalizedShard = shard?.trim().toLowerCase();
  return normalizedShard ? `${normalizedShard}/${normalizedRoom}` : normalizedRoom;
}

export function extractRoomMapOverlayFromEvent(
  event: ScreepsRealtimeEvent
): RoomMapOverlay | null {
  const channel = event.channel.trim();
  if (!channel.toLowerCase().includes("roommap2")) {
    return null;
  }

  const payload = asRecord(event.payload);
  if (!payload) {
    return null;
  }

  const roomName = parseRoomName(channel);
  if (!roomName) {
    return null;
  }

  const shard = parseShard(channel);
  const userPointKeys = Object.keys(payload).filter((key) => USER_ID_PATTERN.test(key));
  const userPoints: RoomMapPoint[] = [];
  for (const key of userPointKeys) {
    userPoints.push(...parsePoints(payload[key]));
  }

  return {
    roomName,
    shard,
    walls: parsePoints(payload.w),
    roads: parsePoints(payload.r),
    powerBanks: parsePoints(payload.pb),
    portals: parsePoints(payload.p),
    sources: parsePoints(payload.s),
    controllers: parsePoints(payload.c),
    minerals: parsePoints(payload.m),
    keepers: parsePoints(payload.k),
    userPoints,
    updatedAt: event.receivedAt,
  };
}
