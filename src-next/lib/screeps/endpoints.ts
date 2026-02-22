import { screepsBatchRequest, screepsRequest } from "./request";
import type {
  EndpointMap,
  EndpointProbe,
  ProbeGroup,
  ScreepsEndpointConfig,
  ScreepsMethod,
} from "./types";

interface SignInCandidate {
  id: string;
  endpoint: string;
  bodyBuilder: (username: string, password: string) => Record<string, string>;
}

interface ProbeSelection {
  selected?: ScreepsEndpointConfig;
  probes: EndpointProbe[];
  sample?: unknown;
}

export interface ProbeSummary {
  endpointMap: EndpointMap;
  probes: EndpointProbe[];
  verifiedAt: string;
  profileSample?: unknown;
}

export interface ProfileProbeSummary {
  profileEndpoint: ScreepsEndpointConfig;
  probes: EndpointProbe[];
  profileSample?: unknown;
}

const SIGNIN_CANDIDATES: SignInCandidate[] = [
  {
    id: "auth_signin_email",
    endpoint: "/api/auth/signin",
    bodyBuilder: (username, password) => ({ email: username, password }),
  },
  {
    id: "auth_signin_username",
    endpoint: "/api/auth/signin",
    bodyBuilder: (username, password) => ({ username, password }),
  },
  {
    id: "user_auth_email",
    endpoint: "/api/user/auth",
    bodyBuilder: (username, password) => ({ email: username, password }),
  },
  {
    id: "user_auth_username",
    endpoint: "/api/user/auth",
    bodyBuilder: (username, password) => ({ username, password }),
  },
];

const PROFILE_CANDIDATES: ScreepsEndpointConfig[] = [
  { id: "auth_me", endpoint: "/api/auth/me", method: "GET" },
  { id: "user_me", endpoint: "/api/user/me", method: "GET" },
];

function buildRoomsCandidates(userId?: string): ScreepsEndpointConfig[] {
  const normalizedUserId = findString(userId);
  const candidates: ScreepsEndpointConfig[] = [];

  if (normalizedUserId) {
    candidates.push({
      id: "user_rooms_get_with_id",
      endpoint: "/api/user/rooms",
      method: "GET",
      query: { id: normalizedUserId },
    });
  }

  candidates.push({ id: "user_rooms_get", endpoint: "/api/user/rooms", method: "GET" });

  return candidates;
}

const STATS_CANDIDATES: ScreepsEndpointConfig[] = [
  {
    id: "user_stats_interval",
    endpoint: "/api/user/stats",
    method: "GET",
    query: { interval: 8, statName: "energyHarvested" },
  },
  { id: "user_stats_plain", endpoint: "/api/user/stats", method: "GET" },
  {
    id: "user_overview",
    endpoint: "/api/user/overview",
    method: "POST",
    body: { interval: 8, statName: "energyHarvested", shard: "shard0" },
  },
];

const OPTIMISTIC_ENDPOINT_MAP: EndpointMap = {
  profile: { id: "user_me", endpoint: "/api/user/me", method: "GET" },
  rooms: { id: "user_rooms_get", endpoint: "/api/user/rooms", method: "GET" },
  stats: {
    id: "user_stats_interval",
    endpoint: "/api/user/stats",
    method: "GET",
    query: { interval: 8, statName: "energyHarvested" },
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function findString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export function extractUserId(payload: unknown): string | undefined {
  const root = asRecord(payload) ?? {};
  const user = asRecord(root.user) ?? {};
  return (
    findString(user._id) ??
    findString(user.id) ??
    findString(root._id) ??
    findString(root.id) ??
    findString(root.userId) ??
    undefined
  );
}

function extractToken(payload: unknown): string | null {
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (typeof current === "string") {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      continue;
    }

    const directToken = findString(record.token) ?? findString(record.authToken);
    if (directToken) {
      return directToken;
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return null;
}

function extractError(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const candidates = [record.error, record.message, record.text];
  for (const candidate of candidates) {
    const result = findString(candidate);
    if (result) {
      return result;
    }
  }
  return null;
}

function endpointMethod(config: ScreepsEndpointConfig): ScreepsMethod {
  return config.method ?? "GET";
}

async function probeGroup(
  group: ProbeGroup,
  candidates: ScreepsEndpointConfig[],
  baseUrl: string,
  token: string,
  username: string | undefined,
  required: boolean
): Promise<ProbeSelection> {
  const probes: EndpointProbe[] = [];

  const responses = await screepsBatchRequest(
    candidates.map((candidate) => ({
      baseUrl,
      endpoint: candidate.endpoint,
      method: endpointMethod(candidate),
      query: candidate.query,
      body: candidate.body,
      token,
      username,
    })),
    { maxConcurrency: Math.min(6, candidates.length) }
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const response = responses[index];

    const probe: EndpointProbe = {
      group,
      candidateId: candidate.id,
      endpoint: candidate.endpoint,
      method: endpointMethod(candidate),
      status: response?.status ?? 0,
      ok: response?.ok ?? false,
      error: response?.ok
        ? undefined
        : extractError(response?.data) ?? `HTTP ${response?.status ?? 0}`,
    };
    probes.push(probe);

    if (response?.ok) {
      return {
        selected: candidate,
        probes,
        sample: response.data,
      };
    }
  }

  if (required) {
    const summary = probes
      .map((probe) => `${probe.endpoint} => ${probe.status}${probe.error ? ` (${probe.error})` : ""}`)
      .join("; ");
    throw new Error(`Endpoint verification failed (${group}): ${summary}`);
  }

  return { probes };
}

export async function signInWithPassword(
  baseUrl: string,
  username: string,
  password: string
): Promise<string> {
  const cleanUsername = username.trim();
  const cleanPassword = password.trim();
  if (!cleanUsername || !cleanPassword) {
    throw new Error("Username and password are required.");
  }

  let lastError = "Sign-in failed: no valid response.";

  for (const candidate of SIGNIN_CANDIDATES) {
    try {
      const response = await screepsRequest({
        baseUrl,
        endpoint: candidate.endpoint,
        method: "POST",
        body: candidate.bodyBuilder(cleanUsername, cleanPassword),
      });

      const token = extractToken(response.data);
      if (response.ok && token) {
        return token;
      }

      const reason = extractError(response.data) ?? `HTTP ${response.status}`;
      lastError = `Sign-in failed (${candidate.id}): ${reason}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Sign-in request failed.";
    }
  }

  throw new Error(lastError);
}

export async function probeSupportedEndpoints(
  baseUrl: string,
  token: string,
  username?: string
): Promise<ProbeSummary> {
  const profile = await probeGroup(
    "profile",
    PROFILE_CANDIDATES,
    baseUrl,
    token,
    username,
    true
  );
  const profileUserId = extractUserId(profile.sample);
  const rooms = await probeGroup(
    "rooms",
    buildRoomsCandidates(profileUserId),
    baseUrl,
    token,
    username,
    false
  );
  const stats = await probeGroup(
    "stats",
    STATS_CANDIDATES,
    baseUrl,
    token,
    username,
    false
  );

  const profileEndpoint = profile.selected;
  if (!profileEndpoint) {
    throw new Error("No available profile endpoint.");
  }

  return {
    endpointMap: {
      profile: profileEndpoint,
      rooms: rooms.selected,
      stats: stats.selected,
    },
    probes: [...profile.probes, ...rooms.probes, ...stats.probes],
    verifiedAt: new Date().toISOString(),
    profileSample: profile.sample,
  };
}

export async function probeProfileEndpoint(
  baseUrl: string,
  token: string,
  username?: string
): Promise<ProfileProbeSummary> {
  const profile = await probeGroup(
    "profile",
    PROFILE_CANDIDATES,
    baseUrl,
    token,
    username,
    true
  );

  const profileEndpoint = profile.selected;
  if (!profileEndpoint) {
    throw new Error("No available profile endpoint.");
  }

  return {
    profileEndpoint,
    probes: profile.probes,
    profileSample: profile.sample,
  };
}

export function buildOptimisticEndpointMap(
  profileOverride?: ScreepsEndpointConfig,
  profileSample?: unknown
): EndpointMap {
  const profileUserId = extractUserId(profileSample);
  const profile = profileOverride
    ? {
        ...profileOverride,
        query: profileOverride.query ? { ...profileOverride.query } : undefined,
        body:
          profileOverride.body && typeof profileOverride.body === "object"
            ? { ...(profileOverride.body as Record<string, unknown>) }
            : profileOverride.body,
      }
    : { ...OPTIMISTIC_ENDPOINT_MAP.profile };
  const rooms = OPTIMISTIC_ENDPOINT_MAP.rooms
    ? {
        ...OPTIMISTIC_ENDPOINT_MAP.rooms,
        query: profileUserId ? { id: profileUserId } : OPTIMISTIC_ENDPOINT_MAP.rooms.query,
      }
    : undefined;
  const stats = OPTIMISTIC_ENDPOINT_MAP.stats
    ? {
        ...OPTIMISTIC_ENDPOINT_MAP.stats,
        query: OPTIMISTIC_ENDPOINT_MAP.stats.query
          ? { ...OPTIMISTIC_ENDPOINT_MAP.stats.query }
          : undefined,
        body:
          OPTIMISTIC_ENDPOINT_MAP.stats.body &&
          typeof OPTIMISTIC_ENDPOINT_MAP.stats.body === "object"
            ? { ...(OPTIMISTIC_ENDPOINT_MAP.stats.body as Record<string, unknown>) }
            : OPTIMISTIC_ENDPOINT_MAP.stats.body,
      }
    : undefined;

  return {
    profile,
    rooms,
    stats,
  };
}

export function extractUsername(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  if (!record) {
    return fallback;
  }

  const user = asRecord(record.user);
  const candidates = [
    user?.username,
    user?.name,
    record.username,
    record.name,
    user?._id,
    record._id,
  ];
  for (const candidate of candidates) {
    const value = findString(candidate);
    if (value) {
      return value;
    }
  }

  return fallback;
}
