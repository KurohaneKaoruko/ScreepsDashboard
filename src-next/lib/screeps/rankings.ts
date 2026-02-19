import { normalizeBaseUrl, screepsRequest } from "./request";
import type {
  RankingEntry,
  RankingMode,
  RankingSnapshot,
  ScreepsRequest,
  ScreepsResponse,
} from "./types";

interface RankingQuery {
  mode: RankingMode;
  page: number;
  pageSize: number;
  season?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
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

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

async function safeRequest(request: ScreepsRequest): Promise<ScreepsResponse | undefined> {
  try {
    const response = await screepsRequest(request);
    return response.ok ? response : undefined;
  } catch {
    return undefined;
  }
}

function flattenRecords(payload: unknown, depth: number, sink: Record<string, unknown>[]): void {
  if (depth > 5 || payload === null || payload === undefined) {
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

function extractSeasons(payload: unknown): string[] {
  const seasons = new Set<string>();
  const records: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, records);

  for (const record of records) {
    for (const value of Object.values(record)) {
      const season = asString(value);
      if (season && /^\d{4}/.test(season)) {
        seasons.add(season);
      }
    }
  }

  for (const entry of asArray(payload)) {
    const season = asString(entry);
    if (season) {
      seasons.add(season);
    }
  }

  return [...seasons].sort((left, right) => right.localeCompare(left));
}

function extractMetrics(record: Record<string, unknown>): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(record)) {
    const numeric = asNumber(value);
    if (numeric !== undefined) {
      metrics[key] = numeric;
    }
  }
  return metrics;
}

function extractEntries(payload: unknown, pageSize: number): RankingEntry[] {
  const records: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, records);

  const entries: RankingEntry[] = [];
  for (const record of records) {
    const username = firstString([
      record.username,
      asRecord(record.user)?.username,
      record.user,
      record.name,
    ]);

    if (!username) {
      continue;
    }

    const rank = asNumber(record.rank) ?? asNumber(record.place) ?? asNumber(record.index);
    entries.push({
      username,
      rank,
      metrics: extractMetrics(record),
    });

    if (entries.length >= pageSize) {
      break;
    }
  }

  return entries;
}

function collectDimensions(entries: RankingEntry[]): string[] {
  const preferred = ["score", "gcl", "power", "cpu", "pixels"];
  const set = new Set<string>();

  for (const entry of entries) {
    for (const key of Object.keys(entry.metrics)) {
      set.add(key);
    }
  }

  const sorted = [...set].sort((left, right) => left.localeCompare(right));
  const output: string[] = [];

  for (const key of preferred) {
    if (set.has(key)) {
      output.push(key);
    }
  }

  for (const key of sorted) {
    if (!output.includes(key)) {
      output.push(key);
    }
  }

  return output;
}

async function fetchLeaderboardPayload(
  baseUrl: string,
  mode: RankingMode,
  page: number,
  pageSize: number,
  season?: string
): Promise<ScreepsResponse | undefined> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const modeValue = mode === "global" ? "world" : "season";

  const candidates: ScreepsRequest[] = [
    {
      baseUrl,
      endpoint: "/api/leaderboard/list",
      method: "GET",
      query: {
        mode: modeValue,
        limit: pageSize,
        offset,
        ...(season ? { season } : {}),
      },
    },
  ];

  if (mode === "season") {
    candidates.push({
      baseUrl,
      endpoint: "/api/leaderboard/list",
      method: "GET",
      query: {
        mode: "world",
        limit: pageSize,
        offset,
        ...(season ? { season } : {}),
      },
    });
  }

  for (const request of candidates) {
    const response = await safeRequest(request);
    if (response) {
      return response;
    }
  }

  return undefined;
}

export async function fetchRankingSnapshot(
  rawBaseUrl: string,
  query: RankingQuery
): Promise<RankingSnapshot> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const page = Math.max(1, query.page);
  const pageSize = Math.max(5, Math.min(50, query.pageSize));

  const seasonsResponse = await safeRequest({
    baseUrl,
    endpoint: "/api/leaderboard/seasons",
    method: "GET",
  });

  const seasons = extractSeasons(seasonsResponse?.data);
  const season = query.season ?? seasons[0];

  const listResponse = await fetchLeaderboardPayload(baseUrl, query.mode, page, pageSize, season);
  const entries = extractEntries(listResponse?.data, pageSize);
  const dimensions = collectDimensions(entries);

  return {
    fetchedAt: new Date().toISOString(),
    baseUrl,
    mode: query.mode,
    season,
    seasons,
    entries,
    dimensions,
    page,
    pageSize,
  };
}
