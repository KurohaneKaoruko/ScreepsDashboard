import { screepsRequest } from "./request";
import type {
  DashboardResources,
  DashboardSnapshot,
  RoomSummary,
  ScreepsResponse,
  ScreepsSession,
} from "./types";

const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/;

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

function extractResources(profilePayload: unknown, statsPayload?: unknown): DashboardResources {
  const root = asRecord(profilePayload) ?? {};
  const user = asRecord(root.user) ?? root;
  const stats = asRecord(statsPayload) ?? {};
  const cpu = asRecord(user.cpu) ?? asRecord(root.cpu) ?? {};
  const gcl = asRecord(user.gcl) ?? asRecord(root.gcl) ?? {};

  const credits = firstNumber([
    user.money,
    user.credits,
    root.money,
    root.credits,
    stats.credits,
  ]);
  const cpuLimit = firstNumber([cpu.limit, user.cpuLimit, root.cpuLimit, stats.cpuLimit]);
  const cpuUsed = firstNumber([cpu.used, root.cpu, stats.cpuUsed]);
  const cpuBucket = firstNumber([cpu.bucket, root.cpuBucket, stats.cpuBucket]);
  const gclLevel = firstNumber([gcl.level, user.gclLevel, root.gclLevel, stats.gclLevel]);
  const gclProgress = firstNumber([gcl.progress, user.gclProgress, root.gclProgress]);
  const gclProgressTotal = firstNumber([
    gcl.progressTotal,
    user.gclProgressTotal,
    root.gclProgressTotal,
  ]);

  let gclProgressPercent: number | undefined;
  if (
    gclProgress !== undefined &&
    gclProgressTotal !== undefined &&
    gclProgressTotal > 0
  ) {
    gclProgressPercent = (gclProgress / gclProgressTotal) * 100;
  }

  return {
    credits,
    cpuLimit,
    cpuUsed,
    cpuBucket,
    gclLevel,
    gclProgress,
    gclProgressTotal,
    gclProgressPercent,
  };
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
      collectRoomSummary(item, sink, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const controller = asRecord(record.controller) ?? {};
  const roomName = firstString([record.room, record.roomName, record.name, record._id]);

  if (roomName && ROOM_NAME_PATTERN.test(roomName)) {
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

  for (const nested of Object.values(record)) {
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

function getResponseError(response: ScreepsResponse): string {
  const payload = asRecord(response.data);
  const message = firstString([payload?.error, payload?.message, payload?.text]);
  return message ? `${response.status}: ${message}` : `${response.status}`;
}

export async function fetchDashboardSnapshot(session: ScreepsSession): Promise<DashboardSnapshot> {
  const profilePromise = screepsRequest({
    baseUrl: session.baseUrl,
    endpoint: session.endpointMap.profile.endpoint,
    method: session.endpointMap.profile.method,
    query: session.endpointMap.profile.query,
    body: session.endpointMap.profile.body,
    token: session.token,
  });

  const roomsPromise = session.endpointMap.rooms
    ? screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: session.endpointMap.rooms.endpoint,
        method: session.endpointMap.rooms.method,
        query: session.endpointMap.rooms.query,
        body: session.endpointMap.rooms.body,
        token: session.token,
      })
    : Promise.resolve(undefined);

  const statsPromise = session.endpointMap.stats
    ? screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: session.endpointMap.stats.endpoint,
        method: session.endpointMap.stats.method,
        query: session.endpointMap.stats.query,
        body: session.endpointMap.stats.body,
        token: session.token,
      })
    : Promise.resolve(undefined);

  const [profileResponse, roomsResponse, statsResponse] = await Promise.all([
    profilePromise,
    roomsPromise,
    statsPromise,
  ]);

  if (!profileResponse.ok) {
    throw new Error(`用户数据请求失败: ${getResponseError(profileResponse)}`);
  }

  const safeRoomsPayload = roomsResponse?.ok ? roomsResponse.data : undefined;
  const safeStatsPayload = statsResponse?.ok ? statsResponse.data : undefined;

  const resources = extractResources(profileResponse.data, safeStatsPayload);
  const rooms = extractRooms(safeRoomsPayload, profileResponse.data);

  return {
    fetchedAt: new Date().toISOString(),
    resources,
    rooms,
    raw: {
      profile: profileResponse.data,
      rooms: safeRoomsPayload,
      stats: safeStatsPayload,
    },
    statuses: {
      profile: profileResponse.status,
      rooms: roomsResponse?.status,
      stats: statsResponse?.status,
    },
  };
}
