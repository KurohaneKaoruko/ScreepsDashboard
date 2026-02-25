import { screepsBatchRequest, screepsRequest } from "./request";
import { getTerrainFromCache, setTerrainToCache } from "./terrain-cache";
import type {
  OfficialRoomObjectRecord,
  OfficialRoomUserRecord,
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

type RealtimeObjectsUpdateMode = "replace" | "merge";

export interface RoomDetailRealtimePatch extends Partial<RoomDetailSnapshot> {
  objectUpdateMode?: RealtimeObjectsUpdateMode;
  officialObjectUpdateMode?: RealtimeObjectsUpdateMode;
  removedObjectIds?: string[];
  removedOfficialObjectIds?: string[];
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

function collectStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter((item): item is string => item !== undefined);
  }
  // 如果是单个字符串，也包装成数组
  const str = asString(value);
  return str ? [str] : [];
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
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return undefined;
}

function toNumericRecord(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const parsed = asNumber(rawValue);
    if (parsed !== undefined) {
      out[key] = parsed;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseStoreCapacity(
  value: unknown
): number | Record<string, number> | undefined {
  const direct = asNumber(value);
  if (direct !== undefined) {
    return direct;
  }
  return toNumericRecord(value);
}

function parseActionTarget(value: unknown): { x: number; y: number } | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const x = asNumber(record.x);
  const y = asNumber(record.y);
  if (x === undefined || y === undefined) {
    return undefined;
  }

  return { x, y };
}

function parseActionLog(
  value: unknown
): RoomObjectSummary["actionLog"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const keys = [
    "attacked",
    "attack",
    "build",
    "harvest",
    "heal",
    "healed",
    "power",
    "rangedAttack",
    "rangedHeal",
    "repair",
    "reserveController",
    "runReaction",
    "reverseReaction",
    "transferEnergy",
    "upgradeController",
  ] as const;
  const out: NonNullable<RoomObjectSummary["actionLog"]> = {};
  let hasAny = false;
  for (const key of keys) {
    const target = parseActionTarget(record[key]);
    if (!target) {
      continue;
    }
    out[key] = target;
    hasAny = true;
  }

  if (!hasAny) {
    return undefined;
  }

  return out;
}

function parseSpawning(
  value: unknown
): RoomObjectSummary["spawning"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const needTime = firstNumber([record.needTime, record.remainingTime]);
  const spawnTime = firstNumber([record.spawnTime, record.endTime, record.time]);
  if (needTime === undefined && spawnTime === undefined) {
    return undefined;
  }

  return {
    needTime,
    spawnTime,
  };
}

function parseEffects(
  value: unknown
): RoomObjectSummary["effects"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const effects: NonNullable<RoomObjectSummary["effects"]> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const effect = firstNumber([record.effect, record.id]);
    if (effect === undefined) {
      continue;
    }

    effects.push({
      effect,
      power: asNumber(record.power),
      endTime: firstNumber([record.endTime, record.ticksRemaining, record.time]),
    });
  }

  return effects.length > 0 ? effects : undefined;
}

function parseBody(value: unknown): RoomObjectSummary["body"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const body: NonNullable<RoomObjectSummary["body"]> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const type = asString(item);
      if (!type) {
        continue;
      }
      body.push({ type });
      continue;
    }

    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const type = firstString([record.type, record.part]);
    const hits = asNumber(record.hits);
    const boost = firstString([record.boost]);
    if (!type && hits === undefined && !boost) {
      continue;
    }
    body.push({
      type,
      hits,
      boost,
    });
  }

  return body.length > 0 ? body : undefined;
}

function parseSay(value: unknown): RoomObjectSummary["say"] | undefined {
  if (typeof value === "string") {
    const text = asString(value);
    if (!text) {
      return undefined;
    }
    return { text };
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const text = firstString([record.text, record.message, record.say]);
  if (!text) {
    return undefined;
  }

  return {
    text,
    isPublic: asBoolean(record.isPublic ?? record.public),
  };
}

function parseReservation(
  value: unknown
): RoomObjectSummary["reservation"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const username = firstString([record.username, record.name]);
  const user = firstString([record.user, record.userId, record.id, record._id]);
  const endTime = firstNumber([record.endTime, record.time]);
  const ticksToEnd = firstNumber([record.ticksToEnd, record.ticksRemaining, record.ttl]);
  if (!username && !user && endTime === undefined && ticksToEnd === undefined) {
    return undefined;
  }

  return {
    username,
    user,
    endTime,
    ticksToEnd,
  };
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

function toOfficialObjectRecords(value: unknown): OfficialRoomObjectRecord[] {
  const records: OfficialRoomObjectRecord[] = [];

  const appendRecord = (item: unknown, fallbackId?: string) => {
    const record = asRecord(item);
    if (!record) {
      return;
    }

    const x = asNumber(record.x);
    const y = asNumber(record.y);
    if (x === undefined || y === undefined) {
      return;
    }

    const normalizedRecord: OfficialRoomObjectRecord = {
      ...record,
    };
    if (
      fallbackId &&
      !firstString([normalizedRecord._id, normalizedRecord.id])
    ) {
      normalizedRecord._id = fallbackId;
    }
    records.push(normalizedRecord);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      appendRecord(item);
    }
    return records;
  }

  const record = asRecord(value);
  if (!record) {
    return records;
  }

  const directX = asNumber(record.x);
  const directY = asNumber(record.y);
  if (directX !== undefined && directY !== undefined) {
    appendRecord(record);
    return records;
  }

  for (const [key, item] of Object.entries(record)) {
    appendRecord(item, key);
  }

  return records;
}

function toOfficialUsers(value: unknown): Record<string, OfficialRoomUserRecord> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const users: Record<string, OfficialRoomUserRecord> = {};
  for (const [key, rawUser] of Object.entries(record)) {
    const userRecord = asRecord(rawUser);
    if (!userRecord) {
      continue;
    }
    users[key] = userRecord;
  }

  return Object.keys(users).length > 0 ? users : undefined;
}

export function extractOfficialRendererObjects(payload: unknown): OfficialRoomObjectRecord[] {
  const root = asRecord(payload) ?? {};
  const candidates = [
    root.objects,
    root.roomObjects,
    asRecord(root.data)?.objects,
    asRecord(root.data)?.roomObjects,
    asRecord(root.result)?.objects,
    asRecord(root.result)?.roomObjects,
    asRecord(root.message)?.objects,
    asRecord(root.message)?.roomObjects,
  ];

  for (const candidate of candidates) {
    const records = toOfficialObjectRecords(candidate);
    if (records.length > 0) {
      return records;
    }
  }

  return [];
}

export function extractOfficialRendererUsers(
  payload: unknown
): Record<string, OfficialRoomUserRecord> | undefined {
  const root = asRecord(payload) ?? {};
  const candidates = [
    root.users,
    asRecord(root.data)?.users,
    asRecord(root.result)?.users,
    asRecord(root.message)?.users,
  ];

  for (const candidate of candidates) {
    const users = toOfficialUsers(candidate);
    if (users) {
      return users;
    }
  }

  return undefined;
}

export function extractRoomDetailRealtimePatch(
  roomInput: string,
  shardInput: string | undefined,
  payload: unknown
): Partial<RoomDetailSnapshot> | null {
  const roomName = normalizeRoomName(roomInput);
  const shard = normalizeShard(shardInput);
  const parsedRoomObjects = parseRoomObjectEntities(roomName, shard, [payload]);
  const officialObjects = extractOfficialRendererObjects(payload);
  const officialUsers = extractOfficialRendererUsers(payload);
  const gameTime = resolveGameTime([payload]);

  // 提取增量更新模式
  const root = asRecord(payload) ?? {};
  const updateMode = firstString([root.updateMode, root.mode, root.objectUpdateMode]) as
    | RealtimeObjectsUpdateMode
    | undefined;
  const officialUpdateMode = firstString([root.officialUpdateMode, root.officialObjectUpdateMode]) as
    | RealtimeObjectsUpdateMode
    | undefined;

  // 提取需要删除的对象 ID
  const removedObjectIds = collectStringArray(root.removedObjectIds ?? root.removed ?? root.deleted);
  const removedOfficialObjectIds = collectStringArray(
    root.removedOfficialObjectIds ?? root.removedOfficial ?? root.deletedOfficial
  );

  const hasParsedObjects = parsedRoomObjects.objects.length > 0;
  const hasOfficialObjects = officialObjects.length > 0;
  const hasUsers = Boolean(officialUsers && Object.keys(officialUsers).length > 0);
  const hasMeta =
    parsedRoomObjects.owner !== undefined ||
    parsedRoomObjects.controllerLevel !== undefined ||
    parsedRoomObjects.energyAvailable !== undefined ||
    parsedRoomObjects.energyCapacity !== undefined ||
    parsedRoomObjects.shard !== undefined;

  // 检查是否有任何有效数据或增量更新指令
  const hasRemovalData = removedObjectIds.length > 0 || removedOfficialObjectIds.length > 0;
  if (!hasParsedObjects && !hasOfficialObjects && !hasUsers && gameTime === undefined && !hasMeta && !hasRemovalData) {
    return null;
  }

  const result: Partial<RoomDetailSnapshot> = {
    fetchedAt: new Date().toISOString(),
    roomName,
    shard: parsedRoomObjects.shard ?? shard,
    owner: parsedRoomObjects.owner,
    controllerLevel: parsedRoomObjects.controllerLevel,
    energyAvailable: parsedRoomObjects.energyAvailable,
    energyCapacity: parsedRoomObjects.energyCapacity,
    gameTime,
    sources: parsedRoomObjects.sources,
    minerals: parsedRoomObjects.minerals,
    structures: parsedRoomObjects.structures,
    creeps: parsedRoomObjects.creeps,
    objects: parsedRoomObjects.objects,
    officialObjects: hasOfficialObjects ? officialObjects : undefined,
    officialUsers,
  };

  // 添加增量更新元数据
  if (updateMode) {
    (result as RoomDetailRealtimePatch).objectUpdateMode = updateMode;
  }
  if (officialUpdateMode) {
    (result as RoomDetailRealtimePatch).officialObjectUpdateMode = officialUpdateMode;
  }
  if (removedObjectIds.length > 0) {
    (result as RoomDetailRealtimePatch).removedObjectIds = removedObjectIds;
  }
  if (removedOfficialObjectIds.length > 0) {
    (result as RoomDetailRealtimePatch).removedOfficialObjectIds = removedOfficialObjectIds;
  }

  return result;
}

function resolveObjectType(record: Record<string, unknown>): string | undefined {
  const directType = firstString([record.type, record.objectType, record.structureType]);
  if (directType) {
    return directType;
  }

  if (firstNumber([record.progress, record.progressTotal]) !== undefined) {
    return "constructionSite";
  }

  if (firstString([record.depositType])) {
    return "deposit";
  }

  if (firstString([record.mineralType])) {
    return "mineral";
  }

  const resourceType = firstString([record.resourceType, record.resource]);
  if (resourceType === "energy" && firstNumber([record.amount, record.energy]) !== undefined) {
    return "energy";
  }

  if (
    firstString([record.name, record.creepName]) &&
    firstNumber([record.ticksToLive, record.ttl]) !== undefined
  ) {
    return "creep";
  }

  return undefined;
}

function buildObjectSummaryFromRecord(
  record: Record<string, unknown>,
  objectId: string,
  type: string,
  x: number,
  y: number,
  resolvedOwner: string | undefined,
  resolvedName: string | undefined
): RoomObjectSummary {
  const controllerRecord = asRecord(record.controller);
  const store = toNumericRecord(record.store);
  const storeCapacity = parseStoreCapacity(record.storeCapacity);
  const storeCapacityResource = toNumericRecord(record.storeCapacityResource);
  const energy = firstNumber([record.energy, store?.energy]);
  const objectEnergyCapacity = firstNumber([
    record.energyCapacity,
    storeCapacityResource?.energy,
    typeof storeCapacity === "number" ? storeCapacity : storeCapacity?.energy,
  ]);
  const reservation = parseReservation(record.reservation ?? controllerRecord?.reservation);

  return {
    id: objectId,
    type,
    x,
    y,
    owner: resolvedOwner,
    name: resolvedName,
    user: firstString([record.user, record.userId, asRecord(record.owner)?.user]),
    hits: asNumber(record.hits),
    hitsMax: asNumber(record.hitsMax),
    ttl: firstNumber([record.ticksToLive, record.ttl]),
    store,
    storeCapacity,
    storeCapacityResource,
    energy,
    energyCapacity: objectEnergyCapacity,
    level: asNumber(record.level),
    progress: firstNumber([record.progress]),
    progressTotal: firstNumber([record.progressTotal, record.total]),
    ageTime: firstNumber([record.ageTime]),
    decayTime: firstNumber([record.decayTime, record.decay]),
    destroyTime: firstNumber([record.destroyTime, record.destructionTime]),
    depositType: firstString([record.depositType]),
    mineralType: firstString([record.mineralType]),
    body: parseBody(record.body ?? record.bodyParts ?? record.parts),
    say: parseSay(record.say ?? record.message),
    reservation,
    upgradeBlocked: firstNumber([record.upgradeBlocked, controllerRecord?.upgradeBlocked]),
    safeMode: firstNumber([record.safeMode, controllerRecord?.safeMode]),
    isPowerEnabled: asBoolean(record.isPowerEnabled ?? controllerRecord?.isPowerEnabled),
    spawning: parseSpawning(record.spawning),
    cooldownTime: firstNumber([record.cooldownTime, record.cooldown, record.nextRegenerationTime]),
    isPublic: asBoolean(record.isPublic),
    actionLog: parseActionLog(record.actionLog ?? record.actions),
    userId: firstString([record.userId, asRecord(record.owner)?.user, record.user]),
    effects: parseEffects(record.effects),
  };
}

function extractGameTimeFromPayload(payload: unknown): number | undefined {
  const root = asRecord(payload);
  if (!root) {
    return undefined;
  }

  return firstNumber([
    root.gameTime,
    root.time,
    root.tick,
    asRecord(root.data)?.gameTime,
    asRecord(root.data)?.time,
    asRecord(root.data)?.tick,
    asRecord(root.result)?.gameTime,
    asRecord(root.result)?.time,
    asRecord(root.result)?.tick,
    asRecord(root.message)?.gameTime,
    asRecord(root.message)?.time,
    asRecord(root.message)?.tick,
  ]);
}

function resolveGameTime(payloads: unknown[]): number | undefined {
  for (const payload of payloads) {
    const value = extractGameTimeFromPayload(payload);
    if (value !== undefined) {
      return value;
    }
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
    const objectSummary = buildObjectSummaryFromRecord(
      record,
      objectId,
      type,
      x,
      y,
      resolvedOwner,
      resolvedName
    );
    objectMap.set(`${objectId}:${type}:${x}:${y}`, objectSummary);

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
      owner = firstString([
        owner,
        objectSummary.owner,
        objectSummary.user,
        objectSummary.reservation?.username,
      ]);
      controllerLevel = firstNumber([controllerLevel, objectSummary.level, record.level]);
      continue;
    }

    if (type === "creep" || type === "powerCreep") {
      const creepName = objectSummary.name ?? `${type}-${x}-${y}`;
      creepMap.set(creepName, {
        name: creepName,
        role: firstString([record.role, asRecord(record.memory)?.role]),
        x,
        y,
        ttl: objectSummary.ttl,
      });
      continue;
    }

    if (isStructureType(type)) {
      const structureSummary: RoomStructureSummary = {
        type,
        x,
        y,
        hits: objectSummary.hits,
        hitsMax: objectSummary.hitsMax,
      };
      structureMap.set(`${type}:${x}:${y}`, structureSummary);

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
      const objectSummary = buildObjectSummaryFromRecord(
        record,
        objectId,
        type,
        x,
        y,
        resolvedOwner,
        resolvedName
      );
      objectMap.set(`${objectId}:${type}:${x}:${y}`, objectSummary);

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
        owner = firstString([
          owner,
          objectSummary.owner,
          objectSummary.user,
          objectSummary.reservation?.username,
        ]);
        controllerLevel = firstNumber([controllerLevel, objectSummary.level, record.level]);
        continue;
      }

      if (type === "creep" || type === "powerCreep") {
        const creepName = objectSummary.name ?? `${type}-${x}-${y}`;
        creepMap.set(creepName, {
          name: creepName,
          role: firstString([record.role, asRecord(record.memory)?.role]),
          x,
          y,
          ttl: objectSummary.ttl,
        });
        continue;
      }

      if (isStructureType(type)) {
        structureMap.set(`${type}:${x}:${y}`, {
          type,
          x,
          y,
          hits: objectSummary.hits,
          hitsMax: objectSummary.hitsMax,
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

  const [terrainPayload, roomObjectsPayload] = await Promise.all([
    tryTerrain(session.baseUrl, session.token, session.username, roomName, shard),
    tryRoomObjects(session.baseUrl, session.token, session.username, roomName, shard),
  ]);
  const officialObjects = extractOfficialRendererObjects(roomObjectsPayload);
  const officialUsers = extractOfficialRendererUsers(roomObjectsPayload);
  const parsedRoomObjects = parseRoomObjectEntities(roomName, shard, [roomObjectsPayload]);

  let mapStatsPayload: unknown;
  let overviewPayload: unknown;
  let roomsPayload: unknown;
  const shouldFetchFallback = parsedRoomObjects.objects.length === 0 && officialObjects.length === 0;
  if (shouldFetchFallback) {
    [mapStatsPayload, overviewPayload, roomsPayload] = await Promise.all([
      tryMapStats(session.baseUrl, session.token, session.username, roomName, shard),
      tryRoomOverview(session.baseUrl, session.token, session.username, roomName, shard),
      tryUserRooms(session),
    ]);
  }

  const gameTime = resolveGameTime([
    roomObjectsPayload,
    terrainPayload,
    mapStatsPayload,
    overviewPayload,
    roomsPayload,
  ]);

  const core = shouldFetchFallback
    ? parseRoomCore(roomName, [
        mapStatsPayload,
        roomsPayload,
        overviewPayload,
        roomObjectsPayload,
      ])
    : {};

  const fallbackEntities = shouldFetchFallback
    ? parseFallbackEntities(roomName, [
        mapStatsPayload,
        roomsPayload,
        overviewPayload,
      ])
    : {
        sources: [],
        minerals: [],
        structures: [],
        creeps: [],
        objects: [],
      };

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
    gameTime,
    sources,
    minerals,
    structures,
    creeps,
    objects,
    officialObjects: officialObjects.length > 0 ? officialObjects : undefined,
    officialUsers,
  };
}
