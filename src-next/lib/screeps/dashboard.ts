import { normalizeBaseUrl, screepsRequest } from "./request";
import type {
  DashboardSnapshot,
  QueryParams,
  RoomSummary,
  RoomThumbnail,
  ScreepsResponse,
  ScreepsMethod,
  ScreepsSession,
  UserProfileSummary,
  UserResourceSummary,
} from "./types";

const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/;
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

const ROOMS_FALLBACK_ENDPOINTS: DashboardFallbackEndpoint[] = [
  { endpoint: "/api/user/rooms", method: "GET" },
  { endpoint: "/api/user/rooms", method: "POST", body: {} },
  {
    endpoint: "/api/game/rooms",
    method: "POST",
    body: { rooms: [], shard: "shard0" },
  },
];

const DEFAULT_MEMORY_LIMIT_KB = 2_048;
const MEMORY_MB_UPPER_BOUND = 16;
const MEMORY_BYTES_LOWER_BOUND = 16_384;

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

function mergeRoomSummary(
  sink: Map<string, RoomSummary>,
  roomName: string,
  payload: unknown
): void {
  const record = asRecord(payload) ?? {};
  const controller = asRecord(record.controller) ?? {};
  const previous = sink.get(roomName);

  const owner = firstString([record.owner, controller.user, controller.owner, previous?.owner]);
  const level = firstNumber([controller.level, record.level, previous?.level]);
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
    owner,
    level,
    energyAvailable,
    energyCapacity,
  });
}

function collectRoomSummary(
  value: unknown,
  sink: Map<string, RoomSummary>,
  depth: number
): void {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const name = asString(item);
      if (name && ROOM_NAME_PATTERN.test(name)) {
        mergeRoomSummary(sink, name, {});
      }
      collectRoomSummary(item, sink, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const roomName = firstString([record.room, record.roomName, record.name, record._id]);

  if (roomName && ROOM_NAME_PATTERN.test(roomName)) {
    mergeRoomSummary(sink, roomName, record);
  }

  for (const [key, nested] of Object.entries(record)) {
    if (ROOM_NAME_PATTERN.test(key)) {
      mergeRoomSummary(sink, key, nested);
    }
    collectRoomSummary(nested, sink, depth + 1);
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

  for (const candidate of candidates) {
    if (
      endpointIdentity(candidate.endpoint, candidate.method, candidate.query, candidate.body) ===
      selectedKey
    ) {
      continue;
    }

    try {
      const response = await screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: candidate.endpoint,
        method: candidate.method,
        query: candidate.query,
        body: candidate.body,
        token: session.token,
        username: session.username,
      });

      if (!response.ok) {
        continue;
      }
      if (validator && !validator(response.data)) {
        continue;
      }
      return response.data;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getResponseError(response: ScreepsResponse): string {
  const payload = asRecord(response.data);
  const message = firstString([payload?.error, payload?.message, payload?.text]);
  return message ? `${response.status}: ${message}` : `${response.status}`;
}

function extractTerrain(payload: unknown): string | undefined {
  const root = pickPayloadRecord(payload, ["terrain", "encodedTerrain", "roomTerrain"]);
  const roomTerrain = asRecord(root.roomTerrain) ?? {};
  return firstString([root.terrain, root.encodedTerrain, roomTerrain.terrain]);
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
  const terrainQueries: QueryParams[] = [
    { room: room.name, encoded: 1 },
    { room: room.name, encoded: 1, shard: "shard0" },
  ];

  for (const query of terrainQueries) {
    try {
      const response = await screepsRequest({
        baseUrl,
        endpoint: "/api/game/room-terrain",
        method: "GET",
        query,
        token,
        username,
      });
      if (!response.ok) {
        continue;
      }

      const terrainEncoded = extractTerrain(response.data);
      if (!terrainEncoded) {
        continue;
      }

      return {
        ...room,
        terrainEncoded,
        thumbnailSource: "terrain",
      };
    } catch {
      continue;
    }
  }

  return {
    ...room,
    thumbnailSource: "fallback",
  };
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

async function fetchRoomThumbnails(session: ScreepsSession, rooms: RoomSummary[]): Promise<RoomThumbnail[]> {
  if (!rooms.length) {
    return [];
  }

  return mapWithConcurrency(rooms, 4, (room) =>
    fetchRoomThumbnail(session.baseUrl, session.token, session.username, room)
  );
}

export async function fetchDashboardSnapshot(session: ScreepsSession): Promise<DashboardSnapshot> {
  const profilePromise = screepsRequest({
    baseUrl: session.baseUrl,
    endpoint: session.endpointMap.profile.endpoint,
    method: session.endpointMap.profile.method,
    query: session.endpointMap.profile.query,
    body: session.endpointMap.profile.body,
    token: session.token,
    username: session.username,
  }).catch(() => undefined);

  const roomsPromise = session.endpointMap.rooms
    ? screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: session.endpointMap.rooms.endpoint,
        method: session.endpointMap.rooms.method,
        query: session.endpointMap.rooms.query,
        body: session.endpointMap.rooms.body,
        token: session.token,
        username: session.username,
      }).catch(() => undefined)
    : Promise.resolve(undefined);

  const statsPromise = session.endpointMap.stats
    ? screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: session.endpointMap.stats.endpoint,
        method: session.endpointMap.stats.method,
        query: session.endpointMap.stats.query,
        body: session.endpointMap.stats.body,
        token: session.token,
        username: session.username,
      }).catch(() => undefined)
    : Promise.resolve(undefined);

  const [profileResponse, roomsResponse, statsResponse] = await Promise.all([
    profilePromise,
    roomsPromise,
    statsPromise,
  ]);

  let safeProfileResponse = profileResponse;
  if (!safeProfileResponse?.ok) {
    const selectedProfileKey = endpointIdentity(
      session.endpointMap.profile.endpoint,
      session.endpointMap.profile.method,
      session.endpointMap.profile.query,
      session.endpointMap.profile.body
    );

    for (const candidate of PROFILE_FALLBACK_ENDPOINTS) {
      if (
        endpointIdentity(candidate.endpoint, candidate.method, candidate.query, candidate.body) ===
        selectedProfileKey
      ) {
        continue;
      }

      try {
        const response = await screepsRequest({
          baseUrl: session.baseUrl,
          endpoint: candidate.endpoint,
          method: candidate.method,
          query: candidate.query,
          body: candidate.body,
          token: session.token,
          username: session.username,
        });

        if (response.ok) {
          safeProfileResponse = response;
          break;
        }
      } catch {
        continue;
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
  if (!hasUsefulRoomsPayload(safeRoomsPayload) && !profileHasRooms) {
    const fallbackRoomsPayload = await tryFallbackPayload(
      session,
      ROOMS_FALLBACK_ENDPOINTS,
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

  const rooms = extractRooms(safeRoomsPayload, safeProfileResponse.data);
  const roomThumbnails = await fetchRoomThumbnails(session, rooms);

  return {
    fetchedAt: new Date().toISOString(),
    profile,
    rooms,
    roomThumbnails,
  };
}
