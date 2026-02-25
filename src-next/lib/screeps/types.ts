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
  userId?: string;
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
  userId?: string;
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
  shard?: string;
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

export interface RoomObjectActionTarget {
  x: number;
  y: number;
}

export interface RoomObjectActionLog {
  attacked?: RoomObjectActionTarget;
  attack?: RoomObjectActionTarget;
  build?: RoomObjectActionTarget;
  harvest?: RoomObjectActionTarget;
  heal?: RoomObjectActionTarget;
  healed?: RoomObjectActionTarget;
  power?: RoomObjectActionTarget;
  rangedAttack?: RoomObjectActionTarget;
  rangedHeal?: RoomObjectActionTarget;
  repair?: RoomObjectActionTarget;
  reserveController?: RoomObjectActionTarget;
  runReaction?: RoomObjectActionTarget;
  reverseReaction?: RoomObjectActionTarget;
  transferEnergy?: RoomObjectActionTarget;
  upgradeController?: RoomObjectActionTarget;
}

export interface RoomObjectSpawningSummary {
  needTime?: number;
  spawnTime?: number;
}

export interface RoomObjectBodyPartSummary {
  type?: string;
  hits?: number;
  boost?: string;
}

export interface RoomObjectSaySummary {
  text: string;
  isPublic?: boolean;
}

export interface RoomObjectReservationSummary {
  username?: string;
  user?: string;
  endTime?: number;
  ticksToEnd?: number;
}

export interface RoomObjectEffectSummary {
  effect: number;
  power?: number;
  endTime?: number;
}

export interface RoomObjectSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  owner?: string;
  name?: string;
  hits?: number;
  hitsMax?: number;
  ttl?: number;
  user?: string;
  store?: Record<string, number>;
  storeCapacity?: number | Record<string, number>;
  storeCapacityResource?: Record<string, number>;
  energy?: number;
  energyCapacity?: number;
  level?: number;
  progress?: number;
  progressTotal?: number;
  ageTime?: number;
  decayTime?: number;
  destroyTime?: number;
  depositType?: string;
  mineralType?: string;
  body?: RoomObjectBodyPartSummary[];
  say?: RoomObjectSaySummary;
  reservation?: RoomObjectReservationSummary;
  upgradeBlocked?: number;
  safeMode?: number;
  isPowerEnabled?: boolean;
  spawning?: RoomObjectSpawningSummary;
  cooldownTime?: number;
  isPublic?: boolean;
  actionLog?: RoomObjectActionLog;
  userId?: string;
  effects?: RoomObjectEffectSummary[];
}

export interface OfficialRoomObjectRecord extends Record<string, unknown> {
  _id?: string;
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  room?: string;
  user?: string;
}

export interface OfficialRoomUserRecord extends Record<string, unknown> {
  _id?: string;
  username?: string;
}

export interface RoomDetailSnapshot {
  fetchedAt: string;
  roomName: string;
  shard?: string;
  owner?: string;
  controllerLevel?: number;
  energyAvailable?: number;
  energyCapacity?: number;
  terrainEncoded?: string;
  gameTime?: number;
  sources: RoomSourceSummary[];
  minerals: RoomMineralSummary[];
  structures: RoomStructureSummary[];
  creeps: RoomCreepSummary[];
  objects: RoomObjectSummary[];
  officialObjects?: OfficialRoomObjectRecord[];
  officialUsers?: Record<string, OfficialRoomUserRecord>;
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

export type MarketOrderType = "buy" | "sell";

export interface MarketOrderSummary {
  id: string;
  resourceType: string;
  type: MarketOrderType;
  price: number;
  amount: number;
  remainingAmount: number;
  totalAmount?: number;
  roomName?: string;
  shard?: string;
  username?: string;
}

export interface MarketResourceOrders {
  resourceType: string;
  buyOrders: MarketOrderSummary[];
  sellOrders: MarketOrderSummary[];
}

export interface MarketSnapshot {
  fetchedAt: string;
  credits?: number;
  rooms: RoomSummary[];
  ordersByResource: MarketResourceOrders[];
}

export interface MarketResourceSnapshot {
  fetchedAt: string;
  resourceType: string;
  credits?: number;
  rooms: RoomSummary[];
  resourceOrders: MarketResourceOrders;
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

export type MessageFolder = "inbox" | "sent";

export interface MessageSummary {
  id: string;
  folder: MessageFolder;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  unread?: boolean;
  createdAt?: string;
}

export interface ProcessedMessageParticipant {
  id: string;
  username: string;
  isSelf: boolean;
}

export type ProcessedMessageDirection = "inbound" | "outbound";

export interface ProcessedConversationMessage {
  id: string;
  createdAt?: string;
  subject?: string;
  text?: string;
  sender: ProcessedMessageParticipant;
  recipient: ProcessedMessageParticipant;
  direction: ProcessedMessageDirection;
  unread?: boolean;
}

export interface ProcessedConversation {
  peerId: string;
  peerUsername: string;
  peerAvatarUrl?: string;
  peerHasBadge?: boolean;
  messages: ProcessedConversationMessage[];
}

export type ProcessedConversationMap = Record<string, ProcessedConversation>;

export interface MessagesPage {
  fetchedAt: string;
  folder: MessageFolder;
  items: MessageSummary[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SendMessageInput {
  to: string;
  subject?: string;
  text: string;
}

export interface ConsoleExecutionResult {
  feedback?: string;
  raw?: string;
  executedAt: string;
}

export type ConsoleStreamKind = "stdout" | "error" | "system";

export interface ConsoleStreamRecord {
  id: string;
  channel: string;
  shard?: string;
  text: string;
  receivedAt: string;
  kind: ConsoleStreamKind;
}
