import { normalizeBaseUrl, screepsBatchRequest, screepsRequest } from "./request";
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
  username?: string;
}

type LeaderboardApiMode = "world" | "power";

interface ParsedLeaderboardPayload {
  entries: RankingEntry[];
  usersById: Record<string, Record<string, unknown>>;
  totalCount?: number;
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

function toLeaderboardApiMode(mode: RankingMode): LeaderboardApiMode {
  return mode === "power" ? "power" : "world";
}

function normalizeRank(value: unknown): number | undefined {
  const rank = asNumber(value);
  if (rank === undefined) {
    return undefined;
  }
  // Screeps leaderboard ranks are zero-based in payload, display as one-based.
  if (rank >= 0) {
    return Math.floor(rank) + 1;
  }
  return Math.floor(rank);
}

function extractSeasons(payload: unknown): string[] {
  const root = asRecord(payload);
  const seasonsPayload = asArray(root?.seasons ?? payload);
  const seasons = new Set<string>();

  for (const rawSeason of seasonsPayload) {
    if (typeof rawSeason === "string") {
      const season = rawSeason.trim();
      if (season) {
        seasons.add(season);
      }
      continue;
    }

    const seasonRecord = asRecord(rawSeason);
    if (!seasonRecord) {
      continue;
    }
    const seasonId = firstString([seasonRecord._id, seasonRecord.id, seasonRecord.season]);
    if (seasonId) {
      seasons.add(seasonId);
    }
  }

  return [...seasons].sort((left, right) => right.localeCompare(left));
}

function parseUsersById(payload: unknown): Record<string, Record<string, unknown>> {
  const root = asRecord(payload) ?? {};
  const users = asRecord(root.users) ?? {};
  const usersById: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(users)) {
    const parsed = asRecord(value);
    if (parsed) {
      usersById[key] = parsed;
    }
  }

  return usersById;
}

function parseRankingRecord(
  payload: unknown,
  usersById: Record<string, Record<string, unknown>>,
  mode: RankingMode,
  fallbackUsername?: string,
): RankingEntry | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const userId = firstString([record.user, record.userId]);
  const userInfo = userId ? usersById[userId] : undefined;
  const username = firstString([userInfo?.username, record.username, record.name, fallbackUsername, userId]);
  if (!username) {
    return undefined;
  }

  const metricKey = mode === "power" ? "power" : "score";
  const metricValue = asNumber(record.score) ?? asNumber(record.power) ?? asNumber(record.value);
  const metrics: Record<string, number | null> = {
    [metricKey]: metricValue ?? null,
  };

  return {
    username,
    rank: normalizeRank(record.rank),
    metrics,
  };
}

function parseLeaderboardListPayload(payload: unknown, pageSize: number, mode: RankingMode): ParsedLeaderboardPayload {
  const root = asRecord(payload) ?? {};
  const list = asArray(root.list);
  const usersById = parseUsersById(payload);
  const entries: RankingEntry[] = [];

  for (const item of list) {
    const parsed = parseRankingRecord(item, usersById, mode);
    if (!parsed) {
      continue;
    }
    entries.push(parsed);
    if (entries.length >= pageSize) {
      break;
    }
  }

  return {
    entries,
    usersById,
    totalCount: asNumber(root.count),
  };
}

function parseFindPayload(
  payload: unknown,
  season: string | undefined,
  usersById: Record<string, Record<string, unknown>>,
  mode: RankingMode,
  username: string,
): RankingEntry | undefined {
  const root = asRecord(payload) ?? {};
  const list = asArray(root.list);

  if (list.length > 0) {
    let selected: unknown;

    if (season) {
      selected = list.find((item) => asString(asRecord(item)?.season) === season);
    }
    if (!selected) {
      selected = list[list.length - 1];
    }

    return parseRankingRecord(selected, usersById, mode, username);
  }

  return parseRankingRecord(root, usersById, mode, username);
}

function collectDimensions(entries: RankingEntry[], mode: RankingMode): string[] {
  const defaultDimension = mode === "power" ? "power" : "score";
  const preferred = mode === "power" ? ["power", "score"] : ["score", "power"];
  const set = new Set<string>([defaultDimension]);

  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.metrics)) {
      if (value !== null && value !== undefined) {
        set.add(key);
      }
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

async function safeRequest(request: ScreepsRequest): Promise<ScreepsResponse | undefined> {
  try {
    const response = await screepsRequest(request);
    return response.ok ? response : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLeaderboardListPayload(
  baseUrl: string,
  mode: RankingMode,
  page: number,
  pageSize: number,
  season?: string,
): Promise<ScreepsResponse | undefined> {
  const apiMode = toLeaderboardApiMode(mode);
  const offset = Math.max(0, (page - 1) * pageSize);
  const candidates: ScreepsRequest[] = [];

  if (season) {
    candidates.push({
      baseUrl,
      endpoint: "/api/leaderboard/list",
      method: "GET",
      query: {
        mode: apiMode,
        season,
        limit: pageSize,
        offset,
      },
    });
  }

  // Fallback for servers that still expose all-time list without season.
  candidates.push({
    baseUrl,
    endpoint: "/api/leaderboard/list",
    method: "GET",
    query: {
      mode: apiMode,
      limit: pageSize,
      offset,
    },
  });

  try {
    const responses = await screepsBatchRequest(candidates, {
      maxConcurrency: Math.min(4, candidates.length),
    });
    const successful = responses.filter((response) => response.ok);
    if (successful.length === 0) {
      return undefined;
    }

    for (const response of successful) {
      const list = asArray(asRecord(response.data)?.list);
      if (list.length > 0) {
        return response;
      }
    }

    return successful[0];
  } catch {
    return undefined;
  }
}

async function fetchUserLeaderboardEntry(
  baseUrl: string,
  mode: RankingMode,
  username: string,
  season?: string,
): Promise<ScreepsResponse | undefined> {
  return safeRequest({
    baseUrl,
    endpoint: "/api/leaderboard/find",
    method: "GET",
    query: {
      mode: toLeaderboardApiMode(mode),
      username,
      ...(season ? { season } : {}),
    },
  });
}

export async function fetchRankingSnapshot(rawBaseUrl: string, query: RankingQuery): Promise<RankingSnapshot> {
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

  const listResponse = await fetchLeaderboardListPayload(baseUrl, query.mode, page, pageSize, season);
  const parsedList = parseLeaderboardListPayload(listResponse?.data, pageSize, query.mode);
  const dimensions = collectDimensions(parsedList.entries, query.mode);

  let selfEntry: RankingEntry | undefined;
  const username = asString(query.username);
  if (username) {
    const selfResponse = await fetchUserLeaderboardEntry(baseUrl, query.mode, username, season);
    selfEntry = parseFindPayload(selfResponse?.data, season, parsedList.usersById, query.mode, username);
  }

  return {
    fetchedAt: new Date().toISOString(),
    baseUrl,
    mode: query.mode,
    season,
    seasons,
    entries: parsedList.entries,
    selfEntry,
    dimensions,
    totalCount: parsedList.totalCount,
    page,
    pageSize,
  };
}
