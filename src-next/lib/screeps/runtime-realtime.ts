import { type ScreepsRealtimeEvent } from "./realtime-client";

export interface RuntimeMetricsPatch {
  cpuUsed?: number;
  cpuLimit?: number;
  cpuBucket?: number;
  memUsed?: number;
  memLimit?: number;
  memPercent?: number;
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

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = asNumber(value);
    if (numberValue !== undefined) {
      return numberValue;
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

function isRuntimeChannel(channel: string): boolean {
  const normalized = channel.trim().toLowerCase();
  if (
    normalized === "cpu" ||
    normalized === "memory" ||
    normalized === "memory/stats" ||
    normalized === "stats"
  ) {
    return true;
  }

  return (
    normalized.endsWith("/cpu") ||
    normalized.endsWith("/memory") ||
    normalized.includes("/memory/stats") ||
    normalized.endsWith("/stats")
  );
}

export function extractRuntimeMetricsPatch(payload: unknown): RuntimeMetricsPatch | null {
  const root = asRecord(payload) ?? {};
  const cpu = asRecord(root.cpu) ?? {};
  const memory = asRecord(root.memory) ?? asRecord(root.mem) ?? {};
  const runtime = asRecord(root.runtime) ?? {};
  const runtimeCpu = asRecord(runtime.cpu) ?? {};
  const runtimeMemory = asRecord(runtime.memory) ?? asRecord(runtime.mem) ?? {};
  const qos = asRecord(root.qos) ?? asRecord(runtime.qos) ?? {};

  const cpuUsed = firstNumber([
    root.cpuUsed,
    root.cpuCurrent,
    root.used,
    root.current,
    root.cpu,
    cpu.used,
    cpu.current,
    cpu.cpuUsed,
    runtimeCpu.used,
    runtimeCpu.current,
    runtime.cpuUsed,
    runtime.cpu,
  ]);
  const cpuLimit = firstNumber([
    root.cpuLimit,
    root.limit,
    root.cpuMax,
    root.tickLimit,
    cpu.limit,
    cpu.max,
    runtimeCpu.limit,
    runtime.cpuLimit,
    runtime.tickLimit,
  ]);
  const cpuBucket = firstNumber([
    root.cpuBucket,
    root.bucket,
    cpu.bucket,
    runtimeCpu.bucket,
    runtime.bucket,
    qos.bucket,
  ]);

  const memUsed = firstNumber([
    root.memUsed,
    root.memoryUsed,
    root.memCurrent,
    root.mem,
    memory.used,
    memory.current,
    memory.memUsed,
    runtimeMemory.used,
    runtimeMemory.current,
    runtime.memUsed,
    runtime.memoryUsed,
    runtime.memory,
  ]);
  const memLimit = firstNumber([
    root.memLimit,
    root.memoryLimit,
    root.memMax,
    memory.limit,
    memory.max,
    runtimeMemory.limit,
    runtime.memLimit,
    runtime.memoryLimit,
  ]);
  const memPercent =
    normalizePercent(
      firstNumber([
        root.memPercent,
        root.memoryPercent,
        root.memPct,
        memory.percent,
        memory.pct,
        runtimeMemory.percent,
        runtime.memPercent,
        runtime.memoryPercent,
        runtime.memoryRatio,
      ])
    ) ?? toPercent(memUsed, memLimit);

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
  if (memUsed !== undefined) {
    patch.memUsed = memUsed;
  }
  if (memLimit !== undefined) {
    patch.memLimit = memLimit;
  }
  if (memPercent !== undefined) {
    patch.memPercent = memPercent;
  }

  return Object.keys(patch).length ? patch : null;
}

export function extractRuntimeMetricsFromEvent(
  event: ScreepsRealtimeEvent
): RuntimeMetricsPatch | null {
  if (!isRuntimeChannel(event.channel)) {
    return null;
  }
  return extractRuntimeMetricsPatch(event.payload);
}
