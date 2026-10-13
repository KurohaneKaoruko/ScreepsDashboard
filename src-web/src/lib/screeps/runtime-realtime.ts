import { type ScreepsRealtimeEvent } from "./realtime-client";

export interface RuntimeMetricsPatch {
  cpuUsed?: number;
  cpuLimit?: number;
  cpuBucket?: number;
  memUsed?: number;
  memLimit?: number;
  memPercent?: number;
}

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

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value > 0 && value <= 1) {
    return value * 100;
  }
  return value;
}

function toPercent(used: number | undefined, total: number | undefined): number | undefined {
  if (used === undefined || total === undefined || total <= 0) {
    return undefined;
  }
  return (used / total) * 100;
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

function isRuntimeChannel(channel: string): boolean {
  const normalized = channel.trim().toLowerCase();
  if (
    normalized === "cpu" ||
    normalized === "memory" ||
    normalized === "stats" ||
    normalized === "bucket" ||
    normalized === "cpubucket"
  ) {
    return true;
  }

  return (
    normalized.includes("/cpu") ||
    normalized.includes("/memory") ||
    normalized.includes("/stats") ||
    normalized.includes("/bucket") ||
    normalized.includes("/cpubucket")
  );
}

function compactRecords(records: Array<Record<string, unknown> | null>): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  for (const record of records) {
    if (record) {
      output.push(record);
    }
  }
  return output;
}

function pickFromScopes(
  scopes: Record<string, unknown>[],
  keys: readonly string[]
): number | undefined {
  for (const scope of scopes) {
    for (const key of keys) {
      const parsed = asNumber(scope[key]);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

function pickFromNestedScopes(
  scopes: Record<string, unknown>[],
  nestedKey: string,
  keys: readonly string[]
): number | undefined {
  const nestedScopes = compactRecords(scopes.map((scope) => asRecord(scope[nestedKey])));
  return pickFromScopes(nestedScopes, keys);
}

export function extractRuntimeMetricsPatch(payload: unknown): RuntimeMetricsPatch | null {
  const root = asRecord(payload) ?? {};
  const scopes = compactRecords([
    root,
    asRecord(root.data),
    asRecord(root.result),
    asRecord(root.message),
    asRecord(root.payload),
    asRecord(root.runtime),
  ]);

  const cpuUsed =
    pickFromScopes(scopes, ["cpuUsed", "cpu"]) ?? pickFromNestedScopes(scopes, "cpu", ["cpu", "used"]);
  const cpuLimit =
    pickFromScopes(scopes, ["cpuLimit", "tickLimit"]) ??
    pickFromNestedScopes(scopes, "cpu", ["cpuLimit", "limit"]);
  const cpuBucket =
    pickFromScopes(scopes, ["cpubucket", "cpuBucket", "bucket"]) ??
    pickFromNestedScopes(scopes, "cpu", ["cpubucket", "cpuBucket", "bucket"]);

  const memUsed =
    pickFromScopes(scopes, ["memory"]) ?? pickFromNestedScopes(scopes, "memory", ["memory", "used"]);
  const memLimit =
    pickFromScopes(scopes, ["memoryLimit"]) ??
    pickFromNestedScopes(scopes, "memory", ["memoryLimit", "limit"]);
  const rawResolvedMemLimit =
    memLimit ?? (memUsed !== undefined ? DEFAULT_MEMORY_LIMIT_KB : undefined);
  const normalizedMemory = normalizeMemoryToKB(memUsed, rawResolvedMemLimit);
  const normalizedMemUsed = normalizedMemory.used;
  const normalizedMemLimit = normalizedMemory.limit;
  const memPercent =
    normalizePercent(
      pickFromScopes(scopes, ["memoryPercent"]) ??
        pickFromNestedScopes(scopes, "memory", ["memoryPercent", "percent"])
    ) ?? toPercent(normalizedMemUsed, normalizedMemLimit);

  const patch: RuntimeMetricsPatch = {};
  if (cpuUsed !== undefined) {
    patch.cpuUsed = cpuUsed;
  }
  if (cpuLimit !== undefined) {
    patch.cpuLimit = cpuLimit;
  }
  if (cpuBucket !== undefined) {
    patch.cpuBucket = cpuBucket;
  }
  if (normalizedMemUsed !== undefined) {
    patch.memUsed = normalizedMemUsed;
  }
  if (normalizedMemLimit !== undefined) {
    patch.memLimit = normalizedMemLimit;
  }
  if (memPercent !== undefined) {
    patch.memPercent = memPercent;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function extractRuntimeMetricsFromEvent(
  event: ScreepsRealtimeEvent
): RuntimeMetricsPatch | null {
  const normalizedChannel = event.channel.trim().toLowerCase();
  const scalar = asNumber(event.payload);

  if (scalar !== undefined) {
    if (normalizedChannel.includes("cpubucket") || normalizedChannel.includes("bucket")) {
      return { cpuBucket: scalar };
    }
    if (normalizedChannel.includes("memory")) {
      const normalizedMemoryScalar = normalizeMemoryToKB(scalar, DEFAULT_MEMORY_LIMIT_KB);
      const normalizedMemUsed = normalizedMemoryScalar.used ?? scalar;
      const normalizedMemLimit = normalizedMemoryScalar.limit ?? DEFAULT_MEMORY_LIMIT_KB;
      return {
        memUsed: normalizedMemUsed,
        memLimit: normalizedMemLimit,
        memPercent: toPercent(normalizedMemUsed, normalizedMemLimit),
      };
    }
    if (normalizedChannel.includes("cpu")) {
      return { cpuUsed: scalar };
    }
  }

  const patch = extractRuntimeMetricsPatch(event.payload);
  if (!patch) {
    return null;
  }

  if (isRuntimeChannel(event.channel)) {
    return patch;
  }

  if (event.channel.startsWith("__")) {
    return null;
  }

  return patch;
}
