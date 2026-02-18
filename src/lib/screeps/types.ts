export type ScreepsMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean;

export type QueryParams = Record<string, QueryValue>;

export interface ScreepsRequest {
  baseUrl: string;
  endpoint: string;
  method?: ScreepsMethod;
  token?: string | null;
  query?: QueryParams;
  body?: unknown;
}

export interface ScreepsResponse {
  status: number;
  ok: boolean;
  data: unknown;
  url: string;
}

export interface ScreepsEndpointConfig {
  id: string;
  endpoint: string;
  method?: ScreepsMethod;
  query?: QueryParams;
  body?: unknown;
}

export type ProbeGroup = "profile" | "rooms" | "stats";

export interface EndpointProbe {
  group: ProbeGroup;
  candidateId: string;
  endpoint: string;
  method: ScreepsMethod;
  status: number;
  ok: boolean;
  error?: string;
}

export interface EndpointMap {
  profile: ScreepsEndpointConfig;
  rooms?: ScreepsEndpointConfig;
  stats?: ScreepsEndpointConfig;
}

export interface ScreepsSession {
  baseUrl: string;
  token: string;
  username: string;
  endpointMap: EndpointMap;
  verifiedAt: string;
  probes: EndpointProbe[];
}

export interface DashboardResources {
  credits?: number;
  cpuLimit?: number;
  cpuUsed?: number;
  cpuBucket?: number;
  gclLevel?: number;
  gclProgress?: number;
  gclProgressTotal?: number;
  gclProgressPercent?: number;
}

export interface RoomSummary {
  name: string;
  owner?: string;
  level?: number;
  energyAvailable?: number;
  energyCapacity?: number;
}

export interface DashboardSnapshot {
  fetchedAt: string;
  resources: DashboardResources;
  rooms: RoomSummary[];
  raw: {
    profile: unknown;
    rooms?: unknown;
    stats?: unknown;
  };
  statuses: {
    profile: number;
    rooms?: number;
    stats?: number;
  };
}

export interface PublicLeaderboardEntry {
  username: string;
  rank?: number;
  score?: number;
}

export interface PublicLeaderboardSummary {
  source: string;
  season?: string;
  entries: PublicLeaderboardEntry[];
}

export interface PublicRoomStat {
  room: string;
  owner?: string;
  level?: number;
  novice?: boolean;
  respawnArea?: boolean;
}

export interface PublicMapSummary {
  terrainRoom: string;
  terrainAvailable: boolean;
  encodedTerrain?: string;
  roomStats: PublicRoomStat[];
  sources: string[];
}

export interface PublicSnapshot {
  fetchedAt: string;
  baseUrl: string;
  leaderboard?: PublicLeaderboardSummary;
  map?: PublicMapSummary;
  statuses: Record<string, number>;
  errors: string[];
  raw: Record<string, unknown>;
}
