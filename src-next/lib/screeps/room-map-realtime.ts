import { type ScreepsRealtimeEvent } from "./realtime-client";
import type { RoomObjectSummary } from "./types";

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

// 构建 room: 频道用于接收建筑对象实时更新
export function buildRoomObjectRealtimeChannels(
  roomName: string,
  shard?: string
): string[] {
  const normalizedRoom = parseRoomName(roomName.trim()) ?? roomName.trim().toUpperCase();
  if (!normalizedRoom) {
    return [];
  }

  const channelSet = new Set<string>([
    `room:${normalizedRoom}`,
    `room:${normalizedRoom.toLowerCase()}`,
  ]);

  const shards = shard ? [shard.toLowerCase()] : [...DEFAULT_SHARDS];
  for (const shardName of shards) {
    channelSet.add(`room:${shardName}/${normalizedRoom}`);
  }

  return [...channelSet];
}

export function toRoomMapOverlayKey(roomName: string, shard?: string): string {
  const normalizedRoom = roomName.trim().toUpperCase();
  const normalizedShard = shard?.trim().toLowerCase();
  return normalizedShard ? `${normalizedShard}/${normalizedRoom}` : normalizedRoom;
}

// 用于 Dashboard 面板的房间对象实时更新
export interface RoomObjectsRealtimeUpdate {
  roomName: string;
  shard?: string;
  objects: RoomObjectSummary[];
  gameTime?: number;
  objectUpdateMode?: "replace" | "merge";
  removedObjectIds?: string[];
  updatedAt: string;
}

const ROOM_CHANNEL_PREFIX = "room:";

function parseRoomChannel(channel: string): { roomName: string; shard?: string } | null {
  const normalizedChannel = channel.trim();
  if (!normalizedChannel.toLowerCase().startsWith(ROOM_CHANNEL_PREFIX)) {
    return null;
  }

  const channelBody = normalizedChannel.slice(ROOM_CHANNEL_PREFIX.length).trim();
  if (!channelBody) {
    return null;
  }

  const slashIndex = channelBody.indexOf("/");
  if (slashIndex < 0) {
    return {
      roomName: channelBody.toUpperCase(),
    };
  }

  const shard = parseShard(channelBody.slice(0, slashIndex));
  const roomName = channelBody.slice(slashIndex + 1).trim().toUpperCase();
  if (!roomName) {
    return null;
  }

  return {
    roomName,
    shard,
  };
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function resolveObjectType(record: Record<string, unknown>): string | undefined {
  const directType = firstString([record.type, record.objectType, record.structureType]);
  if (directType) {
    return directType;
  }

  if (asNumber(record.progress) !== undefined || asNumber(record.progressTotal) !== undefined) {
    return "constructionSite";
  }

  if (firstString([record.depositType])) {
    return "deposit";
  }

  if (firstString([record.mineralType])) {
    return "mineral";
  }

  const resourceType = firstString([record.resourceType, record.resource]);
  if (resourceType === "energy" && (asNumber(record.amount) !== undefined || asNumber(record.energy) !== undefined)) {
    return "energy";
  }

  if (firstString([record.name, record.creepName]) && (asNumber(record.ticksToLive) !== undefined || asNumber(record.ttl) !== undefined)) {
    return "creep";
  }

  return undefined;
}

function buildRoomObjectSummary(record: Record<string, unknown>, objectId: string, type: string, x: number, y: number): RoomObjectSummary {
  const rec = record as Record<string, unknown>;
  const controller = rec.controller as Record<string, unknown> | undefined;
  return {
    id: objectId,
    type,
    x,
    y,
    owner: firstString([(rec.owner as Record<string, unknown>)?.user as string | undefined, rec.user, rec.userId]) as string | undefined,
    user: firstString([rec.user, rec.userId]) as string | undefined,
    userId: firstString([rec.userId, rec.user]) as string | undefined,
    name: firstString([rec.name, rec.creepName]) as string | undefined,
    hits: asNumber(rec.hits),
    hitsMax: asNumber(rec.hitsMax),
    ttl: asNumber(rec.ticksToLive ?? rec.ttl),
    store: undefined,
    storeCapacity: undefined,
    storeCapacityResource: undefined,
    energy: asNumber(rec.energy),
    energyCapacity: asNumber(rec.energyCapacity),
    level: asNumber(rec.level),
    progress: asNumber(rec.progress),
    progressTotal: asNumber(rec.progressTotal ?? rec.total),
    ageTime: asNumber(rec.ageTime),
    decayTime: asNumber(rec.decayTime ?? rec.decay),
    destroyTime: asNumber(rec.destroyTime ?? rec.destructionTime),
    depositType: firstString([rec.depositType]) as string | undefined,
    mineralType: firstString([rec.mineralType]) as string | undefined,
    body: undefined,
    say: undefined,
    reservation: undefined,
    upgradeBlocked: asNumber(rec.upgradeBlocked ?? controller?.upgradeBlocked),
    safeMode: asNumber(rec.safeMode ?? controller?.safeMode),
    isPowerEnabled: asBoolean(rec.isPowerEnabled ?? controller?.isPowerEnabled),
    spawning: undefined,
    cooldownTime: asNumber(rec.cooldownTime ?? rec.cooldown ?? rec.nextRegenerationTime),
    isPublic: asBoolean(rec.isPublic),
    actionLog: undefined,
    effects: undefined,
  };
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "1") {
      return true;
    }
    if (lower === "false" || lower === "0") {
      return false;
    }
  }
  return undefined;
}

function collectStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : undefined))
      .filter((item): item is string => item !== undefined);
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

export function extractRoomObjectsRealtimeUpdate(
  event: ScreepsRealtimeEvent
): RoomObjectsRealtimeUpdate | null {
  const channel = event.channel.trim();
  if (!channel.toLowerCase().startsWith(ROOM_CHANNEL_PREFIX)) {
    return null;
  }

  const parsed = parseRoomChannel(channel);
  if (!parsed) {
    return null;
  }

  const payload = asRecord(event.payload);
  if (!payload) {
    return null;
  }

  // 提取对象记录
  const data = payload.data as Record<string, unknown> | undefined;
  const result = payload.result as Record<string, unknown> | undefined;
  const message = payload.message as Record<string, unknown> | undefined;
  const objectCandidates = [
    payload.objects,
    payload.roomObjects,
    data?.objects,
    data?.roomObjects,
    result?.objects,
    result?.roomObjects,
    message?.objects,
    message?.roomObjects,
  ];

  const objectRecords: Record<string, unknown>[] = [];
  for (const candidate of objectCandidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (item && typeof item === "object") {
          objectRecords.push(item as Record<string, unknown>);
        }
      }
    }
  }

  // 如果没有对象记录，检查是否是纯删除消息
  const removedObjectIds = collectStringArray(payload.removed ?? payload.removedObjectIds ?? payload.deleted);
  const updateMode = firstString([payload.updateMode, payload.mode, payload.objectUpdateMode]) as "replace" | "merge" | undefined;

  // 解析对象
  const objects: RoomObjectSummary[] = [];
  for (const record of objectRecords) {
    const x = asNumber(record.x);
    const y = asNumber(record.y);
    if (x === undefined || y === undefined || x < 0 || x > 49 || y < 0 || y > 49) {
      continue;
    }

    const type = resolveObjectType(record);
    if (!type) {
      continue;
    }

    const objectId = firstString([record._id, record.id]) ?? `${type}:${x}:${y}:${objects.length + 1}`;
    const objectSummary = buildRoomObjectSummary(record, objectId, type, x, y);
    objects.push(objectSummary);
  }

  // 提取 gameTime
  const gameTime = asNumber(payload.gameTime ?? payload.time ?? payload.tick ?? data?.gameTime);

  // 如果没有有效数据且没有删除指令，返回 null
  const hasRemovalData = removedObjectIds.length > 0;
  if (objects.length === 0 && !hasRemovalData) {
    return null;
  }

  return {
    roomName: parsed.roomName,
    shard: parsed.shard,
    objects,
    gameTime,
    objectUpdateMode: updateMode,
    removedObjectIds: hasRemovalData ? removedObjectIds : undefined,
    updatedAt: event.receivedAt,
  };
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
