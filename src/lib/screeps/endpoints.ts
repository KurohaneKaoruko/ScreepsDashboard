import { screepsRequest } from "./request";
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

const ROOMS_CANDIDATES: ScreepsEndpointConfig[] = [
  { id: "user_rooms_get", endpoint: "/api/user/rooms", method: "GET" },
  { id: "user_rooms_post", endpoint: "/api/user/rooms", method: "POST", body: {} },
  {
    id: "game_rooms",
    endpoint: "/api/game/rooms",
    method: "POST",
    body: { rooms: [], shard: "shard0" },
  },
];

const STATS_CANDIDATES: ScreepsEndpointConfig[] = [
  { id: "user_stats", endpoint: "/api/user/stats", method: "GET" },
  {
    id: "user_overview",
    endpoint: "/api/user/overview",
    method: "POST",
    body: { interval: 8, statName: "energyHarvested", shard: "shard0" },
  },
];

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
  required: boolean
): Promise<ProbeSelection> {
  const probes: EndpointProbe[] = [];

  for (const candidate of candidates) {
    try {
      const response = await screepsRequest({
        baseUrl,
        endpoint: candidate.endpoint,
        method: endpointMethod(candidate),
        query: candidate.query,
        body: candidate.body,
        token,
      });

      const probe: EndpointProbe = {
        group,
        candidateId: candidate.id,
        endpoint: candidate.endpoint,
        method: endpointMethod(candidate),
        status: response.status,
        ok: response.ok,
        error: response.ok ? undefined : extractError(response.data) ?? `HTTP ${response.status}`,
      };
      probes.push(probe);

      if (response.ok) {
        return {
          selected: candidate,
          probes,
          sample: response.data,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      probes.push({
        group,
        candidateId: candidate.id,
        endpoint: candidate.endpoint,
        method: endpointMethod(candidate),
        status: 0,
        ok: false,
        error: message,
      });
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

export async function probeSupportedEndpoints(baseUrl: string, token: string): Promise<ProbeSummary> {
  const profile = await probeGroup("profile", PROFILE_CANDIDATES, baseUrl, token, true);
  const rooms = await probeGroup("rooms", ROOMS_CANDIDATES, baseUrl, token, false);
  const stats = await probeGroup("stats", STATS_CANDIDATES, baseUrl, token, false);

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
