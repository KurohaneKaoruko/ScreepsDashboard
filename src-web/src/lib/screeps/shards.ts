import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeBaseUrl, screepsBatchRequest } from "./request";
import type { ScreepsSession } from "./types";

/**
 * Shard helpers that work for both the official server (shard0..shard3,
 * season) and private servers (custom shard names such as "main").
 *
 * The shard list is discovered from `GET /api/game/shards/info` (and the
 * `/api/game/shards` alias some community drivers expose) and merged with
 * shards observed from the user's own data (rooms, orders, console streams).
 */

export const DEFAULT_KNOWN_SHARDS: readonly string[] = [
  "shard0",
  "shard1",
  "shard2",
  "shard3",
];

const SHARD_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHARDS_CACHE_VERSION = 1;
const SHARDS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** Negative cache for servers that expose no shard listing endpoint. */
const SHARDS_EMPTY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Accepts official names (shard0) and private server names (main, season, custom). */
export function normalizeShardName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const shard = value.trim().toLowerCase();
  if (!shard || !SHARD_NAME_PATTERN.test(shard)) {
    return undefined;
  }
  return shard;
}

/** Orders shard0/shard1/... numerically, then any custom names alphabetically. */
export function sortShardNames(values: Iterable<string>): string[] {
  const shards = [...new Set(values)];
  const shardIndex = (name: string): { kind: number; index: number; label: string } => {
    const match = /^shard(\d+)$/.exec(name);
    if (match) {
      return { kind: 0, index: Number(match[1]), label: name };
    }
    return { kind: 1, index: Number.NaN, label: name };
  };
  shards.sort((left, right) => {
    const leftKey = shardIndex(left);
    const rightKey = shardIndex(right);
    if (leftKey.kind !== rightKey.kind) {
      return leftKey.kind - rightKey.kind;
    }
    if (leftKey.kind === 0 && leftKey.index !== rightKey.index) {
      return leftKey.index - rightKey.index;
    }
    return leftKey.label.localeCompare(rightKey.label);
  });
  return shards;
}

/**
 * Merges shard lists by priority: anything explicitly observed wins, an
 * explicit server list comes next, and the official defaults are only used
 * when we have no information at all (e.g. a server that exposes neither
 * endpoint and no shard-bearing data yet).
 */
export function mergeShardLists(...lists: Array<readonly string[]>): string[] {
  const merged = new Set<string>();
  for (const list of lists) {
    for (const shard of list) {
      const normalized = normalizeShardName(shard);
      if (normalized) {
        merged.add(normalized);
      }
    }
  }

  const hasCustom =
    lists.length > 0 && lists.some((list) => list !== DEFAULT_KNOWN_SHARDS && list.length > 0);
  if (hasCustom) {
    return sortShardNames(merged);
  }
  return [...DEFAULT_KNOWN_SHARDS];
}

/**
 * Resolves which shards a realtime subscription should cover: an explicit
 * shard wins; otherwise fall back to the server's shard list (private
 * servers may expose custom names) and finally the official defaults.
 */
export function resolveSubscriptionShards(
  shard: string | undefined,
  knownShards?: readonly string[]
): string[] {
  const normalized = normalizeShardName(shard);
  if (normalized) {
    return [normalized];
  }
  const candidates = (knownShards ?? [])
    .map((item) => normalizeShardName(item))
    .filter((item): item is string => Boolean(item));
  return candidates.length > 0 ? candidates : [...DEFAULT_KNOWN_SHARDS];
}

interface ShardsCacheEntry {
  shards: string[];
  updatedAt: number;
}

const memoryShardsCache = new Map<string, ShardsCacheEntry>();
const inflightShardsRequests = new Map<string, Promise<string[]>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/** Extracts shard names from any known `shards` payload shape. */
export function extractShardsFromPayload(payload: unknown): string[] {
  const root = asRecord(payload);
  const shardsValue = root?.shards ?? root?.list ?? payload;
  const output = new Set<string>();

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const shard = normalizeShardName(value);
      if (shard) {
        output.add(shard);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    const record = asRecord(value);
    if (record) {
      // { shards: { shard0: {...}, main: {...} } } -> use the keys.
      const name = normalizeShardName(firstString(record.name) ?? firstString(record._id));
      if (name) {
        output.add(name);
      } else {
        for (const key of Object.keys(record)) {
          const shard = normalizeShardName(key);
          if (shard) {
            output.add(shard);
          }
        }
      }
    }
  };

  visit(shardsValue);
  return sortShardNames(output);
}

function shardsCacheKey(baseUrl: string): string {
  return `shards:v${SHARDS_CACHE_VERSION}:${normalizeBaseUrl(baseUrl)}`;
}

function readCachedShards(baseUrl: string): ShardsCacheEntry | null {
  const memory = memoryShardsCache.get(normalizeBaseUrl(baseUrl));
  if (memory && Date.now() - memory.updatedAt < cacheTtlFor(memory)) {
    return memory;
  }

  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(shardsCacheKey(baseUrl));
    if (!raw) {
      return null;
    }
    const parsed = asRecord(JSON.parse(raw) as unknown);
    const shards = Array.isArray(parsed?.shards)
      ? parsed.shards
          .map((item) => normalizeShardName(item))
          .filter((item): item is string => Boolean(item))
      : [];
    const updatedAt = typeof parsed?.updatedAt === "number" ? parsed.updatedAt : 0;
    const entry = { shards, updatedAt };
    if (Date.now() - updatedAt < cacheTtlFor(entry)) {
      memoryShardsCache.set(normalizeBaseUrl(baseUrl), entry);
      return entry;
    }
    return null;
  } catch {
    return null;
  }
}

function cacheTtlFor(entry: ShardsCacheEntry): number {
  return entry.shards.length > 0 ? SHARDS_CACHE_TTL_MS : SHARDS_EMPTY_CACHE_TTL_MS;
}

function writeCachedShards(baseUrl: string, shards: string[]): void {
  const entry: ShardsCacheEntry = { shards, updatedAt: Date.now() };
  // Never persist empty results; the memory cache covers them for this session.
  if (shards.length > 0) {
    memoryShardsCache.set(normalizeBaseUrl(baseUrl), entry);
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(shardsCacheKey(baseUrl), JSON.stringify(entry));
    } catch {
      // Ignore storage write errors in restricted environments.
    }
  } else {
    memoryShardsCache.set(normalizeBaseUrl(baseUrl), entry);
  }
}

/**
 * Asks the server for its shard list. Official servers expose
 * `/api/game/shards/info`; some private/community drivers also answer
 * `/api/game/shards`. Returns [] when neither endpoint is available.
 */
export async function fetchServerShards(session: ScreepsSession): Promise<string[]> {
  const normalizedBaseUrl = normalizeBaseUrl(session.baseUrl);
  const cached = readCachedShards(normalizedBaseUrl);
  if (cached) {
    return cached.shards;
  }

  const inflight = inflightShardsRequests.get(normalizedBaseUrl);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const responses = await screepsBatchRequest(
      [
        {
          baseUrl: session.baseUrl,
          endpoint: "/api/game/shards/info",
          method: "GET",
          token: session.token,
          username: session.username,
        },
        {
          baseUrl: session.baseUrl,
          endpoint: "/api/game/shards",
          method: "GET",
          token: session.token,
          username: session.username,
        },
      ],
      { maxConcurrency: 2 }
    );

    const shards = new Set<string>();
    for (const response of responses) {
      if (!response?.ok) {
        continue;
      }
      for (const shard of extractShardsFromPayload(response.data)) {
        shards.add(shard);
      }
    }

    // A single-element response of e.g. ["ok"] means the endpoint answered
    // but did not describe real shards; only trust lists that look sane.
    const list = sortShardNames(shards);
    const usable = list.filter((shard) => shard !== "ok");
    writeCachedShards(normalizedBaseUrl, usable);
    return usable;
  })().finally(() => {
    inflightShardsRequests.delete(normalizedBaseUrl);
  });

  inflightShardsRequests.set(normalizedBaseUrl, request);
  return request;
}

export interface ServerShardsResult {
  shards: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Shared hook that resolves the shard list for the active session. */
export function useServerShards(session: ScreepsSession | null): ServerShardsResult {
  const sessionKey = session ? `${normalizeBaseUrl(session.baseUrl)}|${session.token}` : null;
  const [shards, setShards] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const lastSessionKeyRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!session) {
      lastSessionKeyRef.current = null;
      setShards([]);
      setError(null);
      setLoading(false);
      return;
    }

    const cached = readCachedShards(session.baseUrl);
    if (cached) {
      setShards(cached.shards);
    }

    let cancelled = false;
    lastSessionKeyRef.current = sessionKey;
    setLoading(true);
    setError(null);

    fetchServerShards(session)
      .then((list) => {
        if (cancelled || lastSessionKeyRef.current !== sessionKey) {
          return;
        }
        // Cache only; the caller merges observed shards on top.
        setShards(list);
      })
      .catch((reason) => {
        if (cancelled || lastSessionKeyRef.current !== sessionKey) {
          return;
        }
        setError(reason instanceof Error ? reason.message : "Failed to load shard list.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nonce, session, sessionKey]);

  const value = useMemo(
    () => ({
      shards,
      loading,
      error,
      refresh,
    }),
    [error, loading, refresh, shards]
  );

  return value;
}
