export type ScreepsMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean;

export type QueryParams = Record<string, QueryValue>;

export interface ScreepsRequest {
  baseUrl: string;
  endpoint: string;
  method?: ScreepsMethod;
  token?: string | null;
  username?: string | null;
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
  serverId?: string;
  accountId?: string;
}

export interface UserResourceSummary {
  credits?: number;
  cpuUnlock?: number;
  pixels?: number;
  accessKey?: string;
}

export interface UserProfileSummary {
  avatarUrl?: string;
  username: string;
  gclLevel?: number;
  gclProgress?: number;
  gclProgressTotal?: number;
  gclProgressPercent?: number;
  gclRank?: number;
  gplLevel?: number;
  gplProgress?: number;
  gplProgressTotal?: number;
  gplProgressPercent?: number;
  gplRank?: number;
  cpuLimit?: number;
  cpuUsed?: number;
  cpuBucket?: number;
  memUsed?: number;
  memLimit?: number;
  memPercent?: number;
  resources: UserResourceSummary;
}

export interface RoomSummary {
  name: string;
  owner?: string;
  level?: number;
  energyAvailable?: number;
  energyCapacity?: number;
}

export interface RoomThumbnail extends RoomSummary {
  terrainEncoded?: string;
  thumbnailSource: "terrain" | "fallback";
}

export interface DashboardSnapshot {
  fetchedAt: string;
  profile: UserProfileSummary;
  rooms: RoomSummary[];
  roomThumbnails: RoomThumbnail[];
}

export interface RoomSourceSummary {
  x: number;
  y: number;
}

export interface RoomMineralSummary {
  type?: string;
  x: number;
  y: number;
}

export interface RoomStructureSummary {
  type: string;
  x: number;
  y: number;
  hits?: number;
  hitsMax?: number;
}

export interface RoomCreepSummary {
  name: string;
  role?: string;
  x: number;
  y: number;
  ttl?: number;
}

export interface RoomDetailSnapshot {
  fetchedAt: string;
  roomName: string;
  owner?: string;
  controllerLevel?: number;
  energyAvailable?: number;
  energyCapacity?: number;
  terrainEncoded?: string;
  sources: RoomSourceSummary[];
  minerals: RoomMineralSummary[];
  structures: RoomStructureSummary[];
  creeps: RoomCreepSummary[];
}

export interface PublicLeaderboardEntry {
  username: string;
  rank?: number;
  score?: number;
  metrics: Record<string, number | null>;
}

export interface PublicLeaderboardSummary {
  source: string;
  season?: string;
  entries: PublicLeaderboardEntry[];
  dimensions: string[];
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
}

export interface PublicSnapshot {
  fetchedAt: string;
  baseUrl: string;
  leaderboard?: PublicLeaderboardSummary;
  map?: PublicMapSummary;
}

export type RankingMode = "global" | "season";

export interface RankingEntry {
  username: string;
  rank?: number;
  metrics: Record<string, number | null>;
}

export interface RankingSnapshot {
  fetchedAt: string;
  baseUrl: string;
  mode: RankingMode;
  season?: string;
  seasons: string[];
  entries: RankingEntry[];
  dimensions: string[];
  page: number;
  pageSize: number;
}
