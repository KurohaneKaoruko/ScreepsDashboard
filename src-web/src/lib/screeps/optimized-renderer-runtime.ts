import type { RoomObjectSummary } from "./types";
import {
  TERRAIN_TEXTURE_ALIASES,
  normalizeObjectType,
  resolveObjectRenderSpec,
  type ObjectRenderSpec,
  type RenderLayer,
  type TextureLayerSpec,
} from "./optimized-renderer-metadata";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

interface ObjectActionPoint {
  x: number;
  y: number;
}

const ACTION_LOG_KEYS = [
  "attacked",
  "attack",
  "build",
  "harvest",
  "heal",
  "healed",
  "power",
  "rangedAttack",
  "rangedHeal",
  "repair",
  "reserveController",
  "runReaction",
  "reverseReaction",
  "transferEnergy",
  "upgradeController",
] as const;

type ActionLogKey = (typeof ACTION_LOG_KEYS)[number];
type NormalizedActionLog = Partial<Record<ActionLogKey, ObjectActionPoint>>;

interface NormalizedBodyPart {
  type: string;
  hits?: number;
  boost?: string;
}

interface NormalizedSay {
  text: string;
  isPublic?: boolean;
}

export interface NormalizedRenderObject {
  id: string;
  type: string;
  x: number;
  y: number;
  owner?: string;
  user?: string;
  ownerColor: string;
  hits?: number;
  hitsMax?: number;
  ttl?: number;
  level?: number;
  progress?: number;
  progressTotal?: number;
  safeMode?: number;
  upgradeBlocked?: number;
  isPowerEnabled?: boolean;
  reservationTicksToEnd?: number;
  energy?: number;
  energyCapacity?: number;
  store: Record<string, number>;
  storeCapacity?: number | Record<string, number>;
  storeCapacityResource: Record<string, number>;
  depositType?: string;
  body?: NormalizedBodyPart[];
  say?: NormalizedSay;
  spawningNeedTime?: number;
  spawningSpawnTime?: number;
  cooldownTime?: number;
  isPublic?: boolean;
  actionLog?: NormalizedActionLog;
  zIndex: number;
  spec: ObjectRenderSpec;
}

export interface RenderOfficialStyleSceneParams {
  ctx: CanvasRenderingContext2D;
  displayWidth: number;
  displayHeight: number;
  camera: CameraState;
  terrainCanvas: HTMLCanvasElement | null;
  atlas: Map<string, HTMLImageElement>;
  objects: NormalizedRenderObject[];
  gameTime: number;
}

interface QueueItem {
  zIndex: number;
  draw: () => void;
}

const GRID_SIZE = 50;
const CELL_WORLD_SIZE = 100;
const ROOM_VIEW_BOX = GRID_SIZE * CELL_WORLD_SIZE;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3.8;
const DEFAULT_ZOOM = 1;
const MIN_RENDERER_INIT_SIZE = 16;
const TWO_PI = Math.PI * 2;

const TERRAIN_PLAIN_RGB: [number, number, number] = [17, 26, 34];
const TERRAIN_SWAMP_RGB: [number, number, number] = [59, 78, 46];
const TERRAIN_WALL_RGB: [number, number, number] = [46, 55, 64];

const OBJECT_BASE_COLORS: Record<string, string> = {
  controller: "#f1c95a",
  creep: "#79f0b7",
  powerCreep: "#66ead9",
  constructedWall: "#3e4652",
  extension: "#8faaff",
  factory: "#ff9f7d",
  keeperLair: "#7f8cb2",
  lab: "#b88dff",
  link: "#7fd6ff",
  mineral: "#9de4f2",
  nuker: "#ff7b9b",
  observer: "#d1ddff",
  portal: "#9e6eff",
  powerBank: "#ff6f75",
  powerSpawn: "#ff8a8a",
  rampart: "#39d777",
  road: "#5f6873",
  source: "#edc95a",
  spawn: "#b8dbff",
  storage: "#9f8160",
  terminal: "#79cbff",
  tower: "#ff9966",
  wall: "#3e4652",
};

const BODY_PART_COLORS: Record<string, string> = {
  move: "#a9b7c7",
  work: "#ffd180",
  carry: "#89e39c",
  attack: "#f06a6a",
  ranged_attack: "#62d4ff",
  tough: "#9fa8da",
  heal: "#7ef1d3",
  claim: "#f5ed8c",
};

const CREEP_BODY_ORDER = ["move", "work", "attack", "ranged_attack", "heal", "claim"] as const;
const CREEP_BACKSIDE_TYPES = new Set<string>(["move"]);
const CREEP_MAX_PARTS = 50;
const CREEP_MAX_PART_HITS = 100;
const CREEP_LINE_WIDTH = 18;
const CREEP_RING_RADIUS = 50;
const CREEP_PART_ANGLE = TWO_PI / CREEP_MAX_PARTS / 2;
const CREEP_ANGLE_SHIFT = -Math.PI / 2;
const ROAD_RADIUS = 15;
const ROAD_COLOR = "#aaaaaa";
const ROAD_DIAGONAL = Math.sin(Math.PI / 4) * ROAD_RADIUS;
const SOURCE_ENERGY_COLOR = "#ffe56d";
const STORAGE_ENERGY_COLOR = "#ffe56d";
const STORAGE_POWER_COLOR = "#f41f33";
const FACTORY_ENERGY_COLOR = "#fac86e";
const CONTROLLER_LEVEL_TOTAL: Record<number, number> = {
  1: 200,
  2: 45_000,
  3: 135_000,
  4: 405_000,
  5: 1_215_000,
  6: 3_645_000,
  7: 10_935_000,
};

interface GridCell {
  x: number;
  y: number;
}

interface TerrainPathMeta {
  hasTerrain: boolean;
  wallPath: string | null;
  swampPath: string | null;
  wallPath2D: Path2D | null;
  swampPath2D: Path2D | null;
}

type TerrainCanvasWithMeta = HTMLCanvasElement & {
  __terrainMeta?: TerrainPathMeta;
};

interface LightingBuffer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

const CONTOUR_PATH_CACHE_LIMIT = 160;
const contourPathCache = new Map<string, string | null>();
const tintedSpriteCache = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();
let lightingBuffer: LightingBuffer | null = null;

const ACTION_COLORS: Partial<Record<ActionLogKey, string>> = {
  attacked: "rgba(243,86,86,0.9)",
  attack: "rgba(243,86,86,0.95)",
  build: "rgba(159,203,255,0.9)",
  harvest: "rgba(244,227,131,0.9)",
  heal: "rgba(126,241,211,0.9)",
  healed: "rgba(126,241,211,0.9)",
  power: "rgba(255,132,182,0.9)",
  rangedAttack: "rgba(255,122,122,0.9)",
  rangedHeal: "rgba(126,241,211,0.9)",
  repair: "rgba(144,224,255,0.9)",
  reserveController: "rgba(202,198,255,0.9)",
  runReaction: "rgba(183,143,255,0.9)",
  reverseReaction: "rgba(183,143,255,0.9)",
  transferEnergy: "rgba(244,227,131,0.9)",
  upgradeController: "rgba(244,227,131,0.95)",
};

const ACTION_ICON_ALIAS: Partial<Record<ActionLogKey, string>> = {
  attacked: "punch",
  attack: "punch",
  build: "fortify",
  harvest: "harvest-energy",
  heal: "renew",
  healed: "renew",
  power: "generate-ops",
  rangedAttack: "snipe",
  rangedHeal: "renew",
  repair: "reinforce",
  reserveController: "defend",
  runReaction: "operate-lab",
  reverseReaction: "operate-lab",
  transferEnergy: "remote-transfer",
  upgradeController: "operate-controller",
};

const DEPOSIT_ALIAS_BY_TYPE: Record<string, { base: string; fill: string }> = {
  biomass: { base: "deposit-biomass", fill: "deposit-biomass-fill" },
  metal: { base: "deposit-metal", fill: "deposit-metal-fill" },
  mist: { base: "deposit-mist", fill: "deposit-mist-fill" },
  silicon: { base: "deposit-silicon", fill: "deposit-silicon-fill" },
};

export {
  GRID_SIZE,
  CELL_WORLD_SIZE,
  ROOM_VIEW_BOX,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  MIN_RENDERER_INIT_SIZE,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getFitZoom(viewport: ViewportSize): number {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return DEFAULT_ZOOM;
  }

  const fitByWidth = viewport.width / ROOM_VIEW_BOX;
  const fitByHeight = viewport.height / ROOM_VIEW_BOX;
  const preferred = Math.min(fitByWidth, fitByHeight * 1.35);
  return clamp(preferred * 0.99, MIN_ZOOM, MAX_ZOOM);
}

function toGridCoordinate(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (!Number.isInteger(rounded) || Math.abs(value - rounded) > 1e-6) {
    return null;
  }
  if (rounded < 0 || rounded >= GRID_SIZE) {
    return null;
  }
  return rounded;
}

function hashColor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 62;
  const lightness = 58;
  const c = ((100 - Math.abs(2 * lightness - 100)) * saturation) / 10000;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness / 100 - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);
  return (red << 16) | (green << 8) | blue;
}

function colorFromHash(seed: string): string {
  return `#${hashColor(seed).toString(16).padStart(6, "0")}`;
}

function toNumericRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[key] = rawValue;
    } else if (typeof rawValue === "string") {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) {
        out[key] = parsed;
      }
    }
  }
  return out;
}

function normalizeActionLog(value: RoomObjectSummary["actionLog"]): NormalizedActionLog | undefined {
  if (!value) {
    return undefined;
  }
  const out: NormalizedActionLog = {};
  let hasAny = false;
  for (const key of ACTION_LOG_KEYS) {
    const target = value[key];
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      continue;
    }
    out[key] = { x: target.x, y: target.y };
    hasAny = true;
  }
  return hasAny ? out : undefined;
}

function normalizeBodyParts(value: RoomObjectSummary["body"]): NormalizedBodyPart[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const parts: NormalizedBodyPart[] = [];
  for (const part of value) {
    const type = typeof part.type === "string" ? part.type.trim().toLowerCase() : "";
    if (!type) {
      continue;
    }
    parts.push({
      type,
      hits: typeof part.hits === "number" && Number.isFinite(part.hits) ? part.hits : undefined,
      boost: typeof part.boost === "string" ? part.boost : undefined,
    });
  }
  return parts.length > 0 ? parts : undefined;
}

function normalizeSay(value: RoomObjectSummary["say"]): NormalizedSay | undefined {
  if (!value || typeof value.text !== "string") {
    return undefined;
  }
  const text = value.text.trim();
  if (!text) {
    return undefined;
  }
  return { text, isPublic: value.isPublic };
}

function resolveDepositAliases(depositType: string | undefined): { base: string; fill: string } {
  if (!depositType) {
    return DEPOSIT_ALIAS_BY_TYPE.biomass;
  }
  const normalized = depositType.trim().toLowerCase();
  return DEPOSIT_ALIAS_BY_TYPE[normalized] ?? DEPOSIT_ALIAS_BY_TYPE.biomass;
}

export function decodeTerrainValues(encoded: string | undefined): Uint8Array | null {
  if (!encoded) {
    return null;
  }
  const trimmed = encoded.trim();
  if (trimmed.length !== GRID_SIZE * GRID_SIZE) {
    return null;
  }
  const terrain = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let index = 0; index < trimmed.length; index += 1) {
    const value = Number(trimmed[index]);
    if (!Number.isFinite(value)) {
      return null;
    }
    terrain[index] = value;
  }
  return terrain;
}

function toPath2D(path: string | null): Path2D | null {
  if (!path || typeof Path2D === "undefined") {
    return null;
  }
  try {
    return new Path2D(path);
  } catch {
    return null;
  }
}

function buildContourPath(cells: readonly GridCell[], diagonalConnect = false): string | null {
  if (!cells.length) {
    return null;
  }

  const key = `${diagonalConnect ? 1 : 0}|${cells.map((cell) => `${cell.x},${cell.y}`).join(";")}`;
  const cached = contourPathCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const array: boolean[][] = Array.from({ length: GRID_SIZE }, () => new Array<boolean>(GRID_SIZE).fill(false));
  const visited: boolean[][] = Array.from({ length: GRID_SIZE }, () => new Array<boolean>(GRID_SIZE).fill(false));
  let hasAny = false;
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= GRID_SIZE || cell.y < 0 || cell.y >= GRID_SIZE) {
      continue;
    }
    array[cell.x][cell.y] = true;
    hasAny = true;
  }
  if (!hasAny) {
    contourPathCache.set(key, null);
    return null;
  }

  const hasCell = (x: number, y: number): boolean => x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && array[x][y];
  const hasUpperLeftJoin = (x: number, y: number): boolean =>
    hasCell(x - 1, y - 1) && (diagonalConnect || hasCell(x - 1, y) || hasCell(x, y - 1));
  const hasUpperRightJoin = (x: number, y: number): boolean =>
    hasCell(x + 1, y - 1) && (diagonalConnect || hasCell(x + 1, y) || hasCell(x, y - 1));
  const hasLowerLeftJoin = (x: number, y: number): boolean =>
    hasCell(x - 1, y + 1) && (diagonalConnect || hasCell(x - 1, y));
  const hasLowerRightJoin = (x: number, y: number): boolean =>
    hasCell(x + 1, y + 1) && (diagonalConnect || hasCell(x + 1, y));

  let path = "";

  function topLeftDownR(x: number, y: number): void {
    if (x > 0 && y > 0 && !hasCell(x - 1, y)) {
      path += "a 50 50 0 0 0 -50 -50 h 50 ";
    } else {
      path += "v -50 ";
    }
  }

  function topLeftUpR(x: number, y: number): void {
    if (y > 0 && x > 0 && !hasCell(x, y - 1)) {
      path += "v -50 a 50 50 0 0 0 50 50 ";
    } else {
      path += "h 50 ";
    }
  }

  function topLeftR(x: number, y: number): void {
    if (x === 0 || hasCell(x - 1, y) || y === 0 || hasCell(x, y - 1)) {
      path += "v -50 h 50 ";
    } else {
      path += "a 50 50 0 0 1 50 -50 ";
    }
  }

  function topRightUpR(x: number, y: number): void {
    if (y > 0 && x < GRID_SIZE - 1 && !hasCell(x, y - 1)) {
      path += "a 50 50 0 0 0 50 -50 v 50 ";
    } else {
      path += "h 50 ";
    }
  }

  function topRightDownR(x: number, y: number): void {
    if (x < GRID_SIZE - 1 && y > 0 && !hasCell(x + 1, y)) {
      path += "h 50 a 50 50 0 0 0 -50 50 ";
    } else {
      path += "v 50 ";
    }
  }

  function topRightR(x: number, y: number): void {
    if (x === GRID_SIZE - 1 || hasCell(x + 1, y) || y === 0 || hasCell(x, y - 1)) {
      path += "h 50 v 50 ";
    } else {
      path += "a 50 50 0 0 1 50 50 ";
    }
  }

  function bottomRightR(x: number, y: number): void {
    if (x === GRID_SIZE - 1 || hasCell(x + 1, y) || y === GRID_SIZE - 1 || hasCell(x, y + 1) || hasLowerRightJoin(x, y)) {
      path += "v 50 h -50 ";
    } else {
      path += "a 50 50 0 0 1 -50 50 ";
    }
  }

  function bottomLeftR(x: number, y: number): void {
    if (x === 0 || hasCell(x - 1, y) || y === GRID_SIZE - 1 || hasCell(x, y + 1) || hasLowerLeftJoin(x, y)) {
      path += "h -50 v -50 ";
    } else {
      path += "a 50 50 0 0 1 -50 -50 ";
    }
  }

  function recurs(x: number, y: number, horizontalMode: 0 | 1): void {
    if (visited[x][y]) {
      path += horizontalMode ? "v 100 " : "h -100 ";
      return;
    }

    if (horizontalMode) {
      if (x === 0 || y === 0 || hasUpperLeftJoin(x, y)) {
        topLeftUpR(x, y);
      } else {
        path += "h 50 ";
      }

      if (x < GRID_SIZE - 1 && hasCell(x + 1, y)) {
        if (x === GRID_SIZE - 1 || y === 0 || hasUpperRightJoin(x, y)) {
          topRightUpR(x, y);
        } else {
          path += "h 50 ";
        }
        recurs(x + 1, y, 1);
        path += "h -100 ";
      } else {
        if (x === GRID_SIZE - 1 || y === 0 || hasUpperRightJoin(x, y)) {
          topRightUpR(x, y);
          topRightDownR(x, y);
        } else {
          topRightR(x, y);
        }
        bottomRightR(x, y);
        path += "h -50 ";
      }
    } else {
      if (x === GRID_SIZE - 1 || y === 0 || hasUpperRightJoin(x, y)) {
        topRightDownR(x, y);
      } else {
        path += "v 50 ";
      }

      if (y < GRID_SIZE - 1 && hasCell(x, y + 1)) {
        path += "v 50 ";
        recurs(x, y + 1, 0);
        path += "v -50 ";
      } else {
        bottomRightR(x, y);
        bottomLeftR(x, y);
      }

      if (x === 0 || y === 0 || hasCell(x - 1, y - 1)) {
        topLeftDownR(x, y);
      } else {
        path += "v -50 ";
      }
    }

    visited[x][y] = true;
  }

  for (let x = 0; x < GRID_SIZE; x += 1) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      if (!array[x][y] || visited[x][y]) {
        continue;
      }
      path += `M ${x * 100} ${y * 100 + 50} `;
      visited[x][y] = true;

      let horizontal = 0;
      do {
        horizontal += 1;
      } while (x + horizontal < GRID_SIZE && hasCell(x + horizontal, y));

      let vertical = 0;
      do {
        vertical += 1;
      } while (y + vertical < GRID_SIZE && hasCell(x, y + vertical));

      if (vertical < horizontal) {
        if (x === 0 || y === 0 || hasUpperLeftJoin(x, y)) {
          topLeftDownR(x, y);
          topLeftUpR(x, y);
        } else {
          topLeftR(x, y);
        }

        if (x < GRID_SIZE - 1 && hasCell(x + 1, y)) {
          if (x === GRID_SIZE - 1 || y === 0 || hasUpperRightJoin(x, y)) {
            topRightUpR(x, y);
          } else {
            path += "h 50 ";
          }
          recurs(x + 1, y, 1);
          path += "h -50 ";
        } else {
          if (x === GRID_SIZE - 1 || y === 0 || hasUpperRightJoin(x, y)) {
            topRightUpR(x, y);
            topRightDownR(x, y);
          } else {
            topRightR(x, y);
          }
          bottomRightR(x, y);
        }
        bottomLeftR(x, y);
      } else {
        if (x === 0 || y === 0 || hasUpperLeftJoin(x, y)) {
          topLeftDownR(x, y);
          topLeftUpR(x, y);
        } else {
          topLeftR(x, y);
        }

        if (x === GRID_SIZE - 1 || y === 0 || hasUpperRightJoin(x, y)) {
          topRightUpR(x, y);
          topRightDownR(x, y);
        } else {
          topRightR(x, y);
        }

        if (y < GRID_SIZE - 1 && hasCell(x, y + 1)) {
          path += "v 50 ";
          recurs(x, y + 1, 0);
          path += "v -50 ";
        } else {
          bottomRightR(x, y);
          bottomLeftR(x, y);
        }
      }

      path += "Z ";
    }
  }

  if (contourPathCache.size >= CONTOUR_PATH_CACHE_LIMIT) {
    const firstKey = contourPathCache.keys().next().value;
    if (firstKey) {
      contourPathCache.delete(firstKey);
    }
  }
  const finalPath = path || null;
  contourPathCache.set(key, finalPath);
  return finalPath;
}

export function buildTerrainCanvas(terrainValues: Uint8Array | null): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const walls: GridCell[] = [];
  const swamps: GridCell[] = [];
  if (terrainValues) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const index = y * GRID_SIZE + x;
        const terrainValue = terrainValues[index];
        if ((terrainValue & 1) === 1) {
          walls.push({ x, y });
        } else if ((terrainValue & 2) === 2) {
          swamps.push({ x, y });
        }
      }
    }
  }

  const wallPath = buildContourPath(walls, false);
  const swampPath = buildContourPath(swamps, false);
  (canvas as TerrainCanvasWithMeta).__terrainMeta = {
    hasTerrain: Boolean(terrainValues),
    wallPath,
    swampPath,
    wallPath2D: toPath2D(wallPath),
    swampPath2D: toPath2D(swampPath),
  };

  // Fallback preview for environments without Path2D support.
  const image = ctx.createImageData(GRID_SIZE, GRID_SIZE);
  const data = image.data;
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = y * GRID_SIZE + x;
      const terrainValue = terrainValues ? terrainValues[index] : 0;
      let rgb = TERRAIN_PLAIN_RGB;
      if ((terrainValue & 1) === 1) {
        rgb = TERRAIN_WALL_RGB;
      } else if ((terrainValue & 2) === 2) {
        rgb = TERRAIN_SWAMP_RGB;
      }
      const grain = ((x * 13 + y * 31) % 11) - 5;
      const base = index * 4;
      data[base] = clamp(rgb[0] + grain, 0, 255);
      data[base + 1] = clamp(rgb[1] + grain, 0, 255);
      data[base + 2] = clamp(rgb[2] + grain, 0, 255);
      data[base + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  return canvas;
}

export function buildNormalizedObjects(roomObjects: RoomObjectSummary[] | undefined): NormalizedRenderObject[] {
  if (!roomObjects?.length) {
    return [];
  }

  const objects: NormalizedRenderObject[] = [];
  for (const item of roomObjects) {
    const x = toGridCoordinate(item.x);
    const y = toGridCoordinate(item.y);
    if (x === null || y === null) {
      continue;
    }

    const type = normalizeObjectType(item.type);
    const spec = resolveObjectRenderSpec(type);
    const store = toNumericRecord(item.store);
    const ownerSeed = item.owner ?? item.user ?? item.userId;

    objects.push({
      id: item.id,
      type,
      x,
      y,
      owner: item.owner,
      user: item.user,
      ownerColor: ownerSeed ? colorFromHash(ownerSeed) : "#9ac5ff",
      hits: item.hits,
      hitsMax: item.hitsMax,
      ttl: item.ttl,
      level: item.level,
      progress: item.progress,
      progressTotal: item.progressTotal,
      safeMode: item.safeMode,
      upgradeBlocked: item.upgradeBlocked,
      isPowerEnabled: item.isPowerEnabled,
      reservationTicksToEnd: item.reservation?.ticksToEnd,
      energy: item.energy,
      energyCapacity: item.energyCapacity,
      store,
      storeCapacity: item.storeCapacity,
      storeCapacityResource: toNumericRecord(item.storeCapacityResource),
      depositType: item.depositType,
      body: normalizeBodyParts(item.body),
      say: normalizeSay(item.say),
      spawningNeedTime: item.spawning?.needTime,
      spawningSpawnTime: item.spawning?.spawnTime,
      cooldownTime: item.cooldownTime,
      isPublic: item.isPublic,
      actionLog: normalizeActionLog(item.actionLog),
      zIndex: spec.zIndex,
      spec,
    });
  }

  return objects.sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id));
}

function addAlias(aliases: Set<string>, alias: string): void {
  if (alias) {
    aliases.add(alias);
  }
}

export function collectRequiredAliases(objects: NormalizedRenderObject[]): string[] {
  const aliases = new Set<string>(TERRAIN_TEXTURE_ALIASES);
  for (const object of objects) {
    for (const layer of object.spec.textureLayers) {
      if (object.type === "deposit" && layer.alias.startsWith("deposit-biomass")) {
        const resolved = resolveDepositAliases(object.depositType);
        addAlias(aliases, layer.alias.endsWith("-fill") ? resolved.fill : resolved.base);
      } else {
        addAlias(aliases, layer.alias);
      }
    }
    if (object.type === "extension") {
      addAlias(aliases, "extension-border50");
      addAlias(aliases, "extension-border100");
      addAlias(aliases, "extension-border200");
    }
    if (object.type === "factory") {
      addAlias(aliases, "factory-lvl0");
      addAlias(aliases, "factory-lvl1");
      addAlias(aliases, "factory-lvl2");
      addAlias(aliases, "factory-lvl3");
      addAlias(aliases, "factory-lvl4");
      addAlias(aliases, "factory-lvl5");
      addAlias(aliases, "rectangle");
    }
    if (object.type === "storage" || object.type === "terminal" || object.type === "container") {
      addAlias(aliases, "rectangle");
    }
    if (object.type === "tower") {
      addAlias(aliases, "tower-rotatable-npc");
    }
    if (object.type === "creep" && object.body?.some((part) => part.type === "tough" && (part.hits ?? 0) > 0)) {
      addAlias(aliases, "tough");
    }
    for (const key of ACTION_LOG_KEYS) {
      if (!object.actionLog?.[key]) {
        continue;
      }
      const iconAlias = ACTION_ICON_ALIAS[key];
      if (iconAlias) {
        addAlias(aliases, iconAlias);
      }
    }
  }
  return [...aliases];
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getImageSourceSize(source: CanvasImageSource): { width: number; height: number } | null {
  const candidate = source as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const width = candidate.naturalWidth ?? candidate.videoWidth ?? candidate.width;
  const height = candidate.naturalHeight ?? candidate.videoHeight ?? candidate.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || (width ?? 0) <= 0 || (height ?? 0) <= 0) {
    return null;
  }
  return { width: Math.round(width as number), height: Math.round(height as number) };
}

function getTintedSprite(source: CanvasImageSource, tintColor: string): CanvasImageSource {
  if (typeof document === "undefined") {
    return source;
  }
  const size = getImageSourceSize(source);
  if (!size) {
    return source;
  }
  let sourceCache = tintedSpriteCache.get(source);
  if (!sourceCache) {
    sourceCache = new Map<string, HTMLCanvasElement>();
    tintedSpriteCache.set(source, sourceCache);
  }
  const cached = sourceCache.get(tintColor);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return source;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tintColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  sourceCache.set(tintColor, canvas);
  return canvas;
}

function fillPatternLayer(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  alpha: number,
  tileScale: number,
  blend: GlobalCompositeOperation = "source-over"
): void {
  const pattern = ctx.createPattern(source, "repeat");
  if (!pattern) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = alpha;
  if (typeof pattern.setTransform === "function") {
    const matrix = new DOMMatrix();
    matrix.scaleSelf(tileScale, tileScale);
    pattern.setTransform(matrix);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, ROOM_VIEW_BOX, ROOM_VIEW_BOX);
  } else {
    ctx.scale(tileScale, tileScale);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, ROOM_VIEW_BOX / tileScale, ROOM_VIEW_BOX / tileScale);
  }
  ctx.restore();
}

function getLightingBuffer(width: number, height: number): LightingBuffer | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (!lightingBuffer || lightingBuffer.width !== width || lightingBuffer.height !== height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    lightingBuffer = { canvas, ctx, width, height };
  }
  return lightingBuffer;
}

function drawTerrainVectorLayer(
  ctx: CanvasRenderingContext2D,
  terrainCanvas: HTMLCanvasElement | null,
  atlas: Map<string, HTMLImageElement>
): boolean {
  const meta = (terrainCanvas as TerrainCanvasWithMeta | null)?.__terrainMeta;
  if (!meta?.hasTerrain) {
    return false;
  }
  const wallPath = meta.wallPath2D ?? toPath2D(meta.wallPath);
  const swampPath = meta.swampPath2D ?? toPath2D(meta.swampPath);
  if (!meta.wallPath2D && wallPath) {
    meta.wallPath2D = wallPath;
  }
  if (!meta.swampPath2D && swampPath) {
    meta.swampPath2D = swampPath;
  }

  if (swampPath) {
    ctx.save();
    ctx.fillStyle = "#4a501e";
    ctx.strokeStyle = "#4a501e";
    ctx.lineWidth = 50;
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.4;
    ctx.fill(swampPath);
    ctx.stroke(swampPath);
    ctx.restore();

    const noise2 = atlas.get("noise2");
    if (noise2) {
      ctx.save();
      ctx.clip(swampPath);
      const tintedNoise2 = getTintedSprite(noise2, "#66ff00");
      fillPatternLayer(ctx, tintedNoise2, 0.3, 10, "lighter");
      fillPatternLayer(ctx, tintedNoise2, 0.3, 14, "lighter");
      ctx.restore();
    }
  }

  if (wallPath) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 30;
    ctx.fill(wallPath);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#111111";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.fill(wallPath);
    ctx.stroke(wallPath);
    ctx.restore();

    const noise1 = atlas.get("noise1");
    if (noise1) {
      ctx.save();
      ctx.clip(wallPath);
      fillPatternLayer(ctx, noise1, 0.2, 8, "lighter");
      ctx.restore();
    }
  }
  return true;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  centerX: number,
  centerY: number,
  size: number,
  alpha: number,
  rotation: number,
  tintColor?: string
): void {
  ctx.save();
  ctx.translate(centerX, centerY);
  if (rotation !== 0) {
    ctx.rotate(rotation);
  }
  if (alpha !== 1) {
    ctx.globalAlpha *= alpha;
  }
  const drawable = tintColor ? getTintedSprite(sprite, tintColor) : sprite;
  ctx.drawImage(drawable, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawSpriteRect(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  alpha: number,
  rotation: number,
  tintColor?: string,
  anchorX = 0.5,
  anchorY = 0.5
): void {
  ctx.save();
  ctx.translate(centerX, centerY);
  if (rotation !== 0) {
    ctx.rotate(rotation);
  }
  if (alpha !== 1) {
    ctx.globalAlpha *= alpha;
  }
  const drawX = -width * anchorX;
  const drawY = -height * anchorY;
  const drawable = tintColor ? getTintedSprite(sprite, tintColor) : sprite;
  ctx.drawImage(drawable, drawX, drawY, width, height);
  ctx.restore();
}

function intToColor(value: number): string {
  const normalized = Number.isFinite(value) ? value & 0xffffff : 0;
  return `#${normalized.toString(16).padStart(6, "0")}`;
}

function getStoreValue(object: NormalizedRenderObject, resource: string): number {
  const value = object.store[resource];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (resource === "energy" && typeof object.energy === "number" && Number.isFinite(object.energy)) {
    return object.energy;
  }
  return 0;
}

function getStoreTotal(object: NormalizedRenderObject): number {
  let total = 0;
  for (const value of Object.values(object.store)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
    }
  }
  if (total <= 0 && typeof object.energy === "number" && Number.isFinite(object.energy)) {
    total = object.energy;
  }
  return total;
}

function getStoreCapacityValue(object: NormalizedRenderObject, fallback: number): number {
  if (typeof object.storeCapacity === "number" && Number.isFinite(object.storeCapacity) && object.storeCapacity > 0) {
    return object.storeCapacity;
  }
  if (typeof object.storeCapacity === "object" && object.storeCapacity) {
    let sum = 0;
    for (const value of Object.values(object.storeCapacity)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        sum += value;
      }
    }
    if (sum > 0) {
      return sum;
    }
  }
  return fallback;
}

function getEnergyCapacity(object: NormalizedRenderObject): number {
  const fromStore = object.storeCapacityResource.energy;
  if (typeof fromStore === "number" && Number.isFinite(fromStore) && fromStore > 0) {
    return fromStore;
  }
  if (typeof object.energyCapacity === "number" && Number.isFinite(object.energyCapacity) && object.energyCapacity > 0) {
    return object.energyCapacity;
  }
  return 0;
}

function isNpcOwner(user: string | undefined): boolean {
  return user === "2" || user === "3";
}

function buildRoadSet(objects: NormalizedRenderObject[]): Set<string> {
  const set = new Set<string>();
  for (const object of objects) {
    if (object.type === "road") {
      set.add(`${object.x}:${object.y}`);
    }
  }
  return set;
}

function drawRoad(ctx: CanvasRenderingContext2D, object: NormalizedRenderObject, roads: Set<string>): void {
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const hasNW = roads.has(`${object.x - 1}:${object.y - 1}`);
  const hasN = roads.has(`${object.x}:${object.y - 1}`);
  const hasNE = roads.has(`${object.x + 1}:${object.y - 1}`);
  const hasW = roads.has(`${object.x - 1}:${object.y}`);

  ctx.fillStyle = ROAD_COLOR;
  ctx.beginPath();
  ctx.arc(centerX, centerY, ROAD_RADIUS, 0, TWO_PI);
  ctx.fill();

  if (hasNW) {
    ctx.beginPath();
    ctx.moveTo(centerX + ROAD_DIAGONAL, centerY - ROAD_DIAGONAL);
    ctx.lineTo(centerX - ROAD_DIAGONAL, centerY + ROAD_DIAGONAL);
    ctx.lineTo(centerX - ROAD_DIAGONAL - CELL_WORLD_SIZE, centerY + ROAD_DIAGONAL - CELL_WORLD_SIZE);
    ctx.lineTo(centerX + ROAD_DIAGONAL - CELL_WORLD_SIZE, centerY - ROAD_DIAGONAL - CELL_WORLD_SIZE);
    ctx.closePath();
    ctx.fill();
  }

  if (hasN) {
    ctx.beginPath();
    ctx.moveTo(centerX + ROAD_RADIUS, centerY);
    ctx.lineTo(centerX - ROAD_RADIUS, centerY);
    ctx.lineTo(centerX - ROAD_RADIUS, centerY - CELL_WORLD_SIZE);
    ctx.lineTo(centerX + ROAD_RADIUS, centerY - CELL_WORLD_SIZE);
    ctx.closePath();
    ctx.fill();
  }

  if (hasNE) {
    ctx.beginPath();
    ctx.moveTo(centerX - ROAD_DIAGONAL, centerY - ROAD_DIAGONAL);
    ctx.lineTo(centerX + ROAD_DIAGONAL, centerY + ROAD_DIAGONAL);
    ctx.lineTo(centerX + ROAD_DIAGONAL + CELL_WORLD_SIZE, centerY + ROAD_DIAGONAL - CELL_WORLD_SIZE);
    ctx.lineTo(centerX - ROAD_DIAGONAL + CELL_WORLD_SIZE, centerY - ROAD_DIAGONAL - CELL_WORLD_SIZE);
    ctx.closePath();
    ctx.fill();
  }

  if (hasW) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY + ROAD_RADIUS);
    ctx.lineTo(centerX, centerY - ROAD_RADIUS);
    ctx.lineTo(centerX - CELL_WORLD_SIZE, centerY - ROAD_RADIUS);
    ctx.lineTo(centerX - CELL_WORLD_SIZE, centerY + ROAD_RADIUS);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCreepBodyAndSay(
  ctx: CanvasRenderingContext2D,
  object: NormalizedRenderObject,
  atlas: Map<string, HTMLImageElement>
): void {
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const npc = isNpcOwner(object.user ?? object.owner);

  if (!npc && (object.type === "creep" || object.type === "powerCreep")) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, CREEP_RING_RADIUS, 0, TWO_PI);
    ctx.fillStyle = "#202020";
    ctx.fill();

    if (object.body && object.body.length > 0) {
      const grouped = new Map<string, number>();
      let hasTough = false;
      for (const part of object.body) {
        const type = part.type.trim().toLowerCase();
        const hits = Math.max(0, Number.isFinite(part.hits) ? (part.hits as number) : CREEP_MAX_PART_HITS);
        if (!type || hits <= 0) {
          continue;
        }
        if (type === "tough") {
          hasTough = true;
          continue;
        }
        if (type === "carry") {
          continue;
        }
        grouped.set(type, (grouped.get(type) ?? 0) + hits);
      }

      const parts = [...grouped.entries()]
        .map(([type, hits]) => ({ type, hits }))
        .filter((item) => CREEP_BODY_ORDER.includes(item.type as (typeof CREEP_BODY_ORDER)[number]))
        .sort((left, right) => left.hits - right.hits);
      let frontAngle = 0;
      let backAngle = Math.PI;

      for (const part of parts) {
        const angle = CREEP_PART_ANGLE * (part.hits / CREEP_MAX_PART_HITS);
        if (!Number.isFinite(angle) || angle <= 0) {
          continue;
        }
        const startAngle = CREEP_BACKSIDE_TYPES.has(part.type) ? backAngle : frontAngle;
        const endAngle = startAngle + angle;
        const arcStart = CREEP_ANGLE_SHIFT + startAngle;
        const arcEnd = CREEP_ANGLE_SHIFT + endAngle;
        const color = BODY_PART_COLORS[part.type] ?? "#9db1c8";
        ctx.beginPath();
        ctx.arc(centerX, centerY, CREEP_RING_RADIUS - CREEP_LINE_WIDTH * 0.5, arcStart, arcEnd, false);
        ctx.strokeStyle = color;
        ctx.lineWidth = CREEP_LINE_WIDTH;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(centerX, centerY, CREEP_RING_RADIUS - CREEP_LINE_WIDTH * 0.5, CREEP_ANGLE_SHIFT - startAngle, CREEP_ANGLE_SHIFT - endAngle, true);
        ctx.strokeStyle = color;
        ctx.lineWidth = CREEP_LINE_WIDTH;
        ctx.stroke();
        if (CREEP_BACKSIDE_TYPES.has(part.type)) {
          backAngle = endAngle;
        } else {
          frontAngle = endAngle;
        }
      }

      if (hasTough) {
        const tough = atlas.get("tough");
        if (tough) {
          drawSpriteRect(ctx, tough, centerX, centerY, 120, 120, 1, 0);
        }
      }
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, 32, 0, TWO_PI);
    ctx.fillStyle = "#000000";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centerX, centerY, 26, 0, TWO_PI);
    ctx.fillStyle = object.ownerColor;
    ctx.fill();

    const energy = getStoreValue(object, "energy");
    const power = getStoreValue(object, "power");
    const total = getStoreTotal(object);
    const capacity = getStoreCapacityValue(object, total || 1);
    if (capacity > 0) {
      if (total > energy + power) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 20 * clamp(total / capacity, 0, 1), 0, TWO_PI);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      if (power > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 20 * clamp((energy + power) / capacity, 0, 1), 0, TWO_PI);
        ctx.fillStyle = intToColor(0xf41f33);
        ctx.fill();
      }
      if (energy > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 20 * clamp(energy / capacity, 0, 1), 0, TWO_PI);
        ctx.fillStyle = intToColor(0xffe56d);
        ctx.fill();
      }
    }
  }

  if (object.say?.text) {
    const rawText = object.say.text.trim();
    if (!rawText) {
      return;
    }
    const text = rawText.length > 72 ? `${rawText.slice(0, 71)}...` : rawText;
    const bubbleHeight = 100;
    const bubbleOffset = -170;
    ctx.save();
    ctx.font = "600 60px Roboto, sans-serif";
    const bubbleWidth = clamp(ctx.measureText(text).width + 60, 90, 560);
    const bubbleX = centerX - bubbleWidth * 0.5;
    const bubbleY = centerY + bubbleOffset;
    drawRoundedRectPath(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 30);
    ctx.fillStyle = object.say.isPublic ? intToColor(0xdd8888) : intToColor(0xcccccc);
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + 30, centerY - 74);
    ctx.lineTo(centerX, centerY - 44);
    ctx.lineTo(centerX - 30, centerY - 74);
    ctx.closePath();
    ctx.fillStyle = object.say.isPublic ? intToColor(0xdd8888) : intToColor(0xcccccc);
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, centerX, bubbleY + bubbleHeight * 0.5);
    ctx.restore();
  }
}

function resolveActionAlias(object: NormalizedRenderObject, alias: string): string {
  if (object.type === "deposit" && alias.startsWith("deposit-biomass")) {
    const resolved = resolveDepositAliases(object.depositType);
    return alias.endsWith("-fill") ? resolved.fill : resolved.base;
  }
  return alias;
}

function enqueueTexture(
  ctx: CanvasRenderingContext2D,
  object: NormalizedRenderObject,
  atlas: Map<string, HTMLImageElement>,
  layer: TextureLayerSpec,
  rotation: number,
  objectsQueue: QueueItem[],
  lightingQueue: QueueItem[],
  effectsQueue: QueueItem[]
): boolean {
  const alias = resolveActionAlias(object, layer.alias);
  const sprite = atlas.get(alias);
  if (!sprite) {
    return false;
  }
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * (0.5 + (layer.offsetX ?? 0));
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * (0.5 + (layer.offsetY ?? 0));
  const size = CELL_WORLD_SIZE * (layer.scale ?? 1);
  const alpha = layer.alpha ?? 1;
  const tintColor = layer.tintOwner ? object.ownerColor : undefined;
  const draw = () => drawSprite(ctx, sprite, centerX, centerY, size, alpha, rotation, tintColor);
  const layerId: RenderLayer = layer.layer ?? "objects";
  if (layerId === "lighting") {
    lightingQueue.push({ zIndex: object.zIndex, draw });
  } else if (layerId === "effects") {
    effectsQueue.push({ zIndex: object.zIndex, draw });
  } else {
    objectsQueue.push({ zIndex: object.zIndex, draw });
  }
  return true;
}

interface AliasSpriteOptions {
  alpha?: number;
  rotation?: number;
  tintColor?: string;
  anchorX?: number;
  anchorY?: number;
}

function enqueueAliasSprite(
  ctx: CanvasRenderingContext2D,
  atlas: Map<string, HTMLImageElement>,
  alias: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  zIndex: number,
  queue: QueueItem[],
  options?: AliasSpriteOptions
): boolean {
  const sprite = atlas.get(alias);
  if (!sprite) {
    return false;
  }
  const alpha = options?.alpha ?? 1;
  const rotation = options?.rotation ?? 0;
  queue.push({
    zIndex,
    draw: () =>
      drawSpriteRect(
        ctx,
        sprite,
        centerX,
        centerY,
        width,
        height,
        alpha,
        rotation,
        options?.tintColor,
        options?.anchorX ?? 0.5,
        options?.anchorY ?? 0.5
      ),
  });
  return true;
}

function drawResourceBars(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  baseY: number,
  width: number,
  totalHeight: number,
  energyHeight: number,
  powerHeight: number,
  drawOther: boolean
): void {
  const clampedTotal = Math.max(0, totalHeight);
  const clampedPower = clamp(powerHeight, 0, clampedTotal);
  const clampedEnergy = clamp(energyHeight, 0, clampedPower);
  if (drawOther && clampedTotal > clampedPower) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(centerX - width * 0.5, baseY - clampedTotal, width, clampedTotal);
  }
  if (clampedPower > 0) {
    ctx.fillStyle = STORAGE_POWER_COLOR;
    ctx.fillRect(centerX - width * 0.5, baseY - clampedPower, width, clampedPower);
  }
  if (clampedEnergy > 0) {
    ctx.fillStyle = STORAGE_ENERGY_COLOR;
    ctx.fillRect(centerX - width * 0.5, baseY - clampedEnergy, width, clampedEnergy);
  }
}

function resolveTowerRotation(object: NormalizedRenderObject, gameTime: number): number {
  const target = object.actionLog?.attack ?? object.actionLog?.heal ?? object.actionLog?.repair;
  if (target) {
    return Math.atan2(target.y - object.y, target.x - object.x) + Math.PI / 2;
  }
  const seed = hashColor(object.id) % 1024;
  return ((gameTime + seed) * Math.PI) / 10;
}

function drawSourceCore(ctx: CanvasRenderingContext2D, object: NormalizedRenderObject): void {
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 15;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#111111";
  drawRoundedRectPath(ctx, centerX - 20, centerY - 20, 40, 40, 15);
  ctx.fill();
  ctx.stroke();
  const size = 60 * clamp(getStoreValue(object, "energy") / Math.max(getEnergyCapacity(object), 1), 0, 1);
  if (size > 0) {
    drawRoundedRectPath(ctx, centerX - size * 0.5, centerY - size * 0.5, size, size, 15);
    ctx.fillStyle = SOURCE_ENERGY_COLOR;
    ctx.fill();
  }
  ctx.restore();
}

function drawSpawnCore(ctx: CanvasRenderingContext2D, object: NormalizedRenderObject, gameTime: number): void {
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 70, 0, TWO_PI);
  ctx.fillStyle = intToColor(0xcccccc);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX, centerY, 59, 0, TWO_PI);
  ctx.fillStyle = intToColor(0x181818);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX, centerY, 38, 0, TWO_PI);
  ctx.fillStyle = object.ownerColor;
  ctx.fill();
  const energyScale = clamp(getStoreValue(object, "energy") / Math.max(getEnergyCapacity(object), 1), 0, 1);
  if (energyScale > 0) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 38 * energyScale, 0, TWO_PI);
    ctx.fillStyle = STORAGE_ENERGY_COLOR;
    ctx.fill();
  }
  if (typeof object.spawningNeedTime === "number" && object.spawningNeedTime > 0) {
    const spawnTime =
      typeof object.spawningSpawnTime === "number" && Number.isFinite(object.spawningSpawnTime)
        ? object.spawningSpawnTime
        : gameTime + 0.01;
    const rest = spawnTime - gameTime;
    const ratio = clamp((object.spawningNeedTime - rest) / object.spawningNeedTime, 0, 1);
    ctx.beginPath();
    ctx.arc(centerX, centerY, 50, -Math.PI / 2, -Math.PI / 2 + TWO_PI * ratio);
    ctx.lineWidth = 10;
    ctx.strokeStyle = intToColor(0xcccccc);
    ctx.stroke();
  }
}

function drawControllerCore(
  ctx: CanvasRenderingContext2D,
  object: NormalizedRenderObject,
  atlas: Map<string, HTMLImageElement>,
  objectsQueue: QueueItem[],
  effectsQueue: QueueItem[],
  lightingQueue: QueueItem[]
): void {
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  objectsQueue.push({
    zIndex: object.zIndex,
    draw: () => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, 92, 0, TWO_PI);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(centerX, centerY, 40, 0, TWO_PI);
      ctx.strokeStyle = intToColor(0x080808);
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX, centerY, 26, 0, TWO_PI);
      ctx.fillStyle = object.ownerColor;
      ctx.fill();
    },
  });

  enqueueAliasSprite(ctx, atlas, "controller", centerX, centerY, 200, 200, object.zIndex + 0.005, objectsQueue);

  const level = Math.max(0, Math.min(8, Math.floor(object.level ?? 0)));
  for (let index = 0; index < level; index += 1) {
    enqueueAliasSprite(
      ctx,
      atlas,
      "controller-level",
      centerX,
      centerY,
      100,
      100,
      object.zIndex + 0.01 + index * 0.001,
      objectsQueue,
      {
        rotation: (Math.PI / 4) * index,
        anchorX: 0.5,
        anchorY: 1,
      }
    );
  }

  if (typeof object.progress === "number" && object.progress > 0 && level > 0) {
    const progressTotal = CONTROLLER_LEVEL_TOTAL[level] ?? Math.max(object.progress, 1);
    const ratio = clamp(object.progress / progressTotal, 0, 1);
    objectsQueue.push({
      zIndex: object.zIndex + 0.015,
      draw: () => {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(-Math.PI / 2);
        ctx.beginPath();
        ctx.arc(0, 0, 37, 0, TWO_PI);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 37, 0, TWO_PI * ratio);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fill();
        ctx.restore();
      },
    });
  }

  if (typeof object.safeMode === "number" && object.safeMode > 0) {
    effectsQueue.push({
      zIndex: object.zIndex + 0.02,
      draw: () => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 110, 0, TWO_PI);
        ctx.fillStyle = "rgba(255,204,0,0.08)";
        ctx.fill();
      },
    });
  }

  enqueueAliasSprite(
    ctx,
    atlas,
    "glow",
    centerX,
    centerY,
    1200,
    1200,
    object.zIndex + 0.001,
    lightingQueue,
    { alpha: 0.5 }
  );
  if (object.owner || object.user) {
    enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 500, 500, object.zIndex + 0.002, lightingQueue, {
      alpha: 1,
    });
  }
}

function drawActionLog(
  ctx: CanvasRenderingContext2D,
  object: NormalizedRenderObject,
  atlas: Map<string, HTMLImageElement>,
  gameTime: number
): void {
  if (!object.actionLog) {
    return;
  }
  const originX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const originY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const pulse = 0.6 + 0.4 * (0.5 + Math.sin(gameTime * 8 + object.x + object.y) * 0.5);
  for (const key of ACTION_LOG_KEYS) {
    const target = object.actionLog[key];
    if (!target) {
      continue;
    }
    const targetX = target.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const targetY = target.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
    const midX = (originX + targetX) * 0.5;
    const midY = (originY + targetY) * 0.5;

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(targetX, targetY);
    ctx.strokeStyle = ACTION_COLORS[key] ?? "rgba(168,203,255,0.88)";
    ctx.lineWidth = object.type === "tower" ? 6 : 4;
    ctx.stroke();
    const iconAlias = ACTION_ICON_ALIAS[key];
    const icon = iconAlias ? atlas.get(iconAlias) : undefined;
    if (icon) {
      drawSprite(ctx, icon, midX, midY, 38, pulse, 0, undefined);
    } else {
      ctx.beginPath();
      ctx.arc(midX, midY, 6, 0, TWO_PI);
      ctx.fillStyle = ACTION_COLORS[key] ?? "rgba(168,203,255,0.88)";
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  object: NormalizedRenderObject,
  atlas: Map<string, HTMLImageElement>,
  roads: Set<string>,
  gameTime: number,
  objectsQueue: QueueItem[],
  lightingQueue: QueueItem[],
  effectsQueue: QueueItem[],
  uiQueue: QueueItem[]
): void {
  const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
  const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;

  if (object.type === "road") {
    objectsQueue.push({ zIndex: object.zIndex, draw: () => drawRoad(ctx, object, roads) });
    return;
  }

  const rotation = object.type === "tower" ? resolveTowerRotation(object, gameTime) : 0;
  const useCustomRendering =
    object.type === "controller" ||
    object.type === "spawn" ||
    object.type === "source" ||
    object.type === "extension" ||
    object.type === "terminal" ||
    object.type === "tower" ||
    object.type === "container" ||
    object.type === "creep";
  let hasTexture = false;

  if (object.type === "controller") {
    drawControllerCore(ctx, object, atlas, objectsQueue, effectsQueue, lightingQueue);
    hasTexture = true;
  } else if (object.type === "source") {
    objectsQueue.push({ zIndex: object.zIndex + 0.01, draw: () => drawSourceCore(ctx, object) });
    enqueueAliasSprite(
      ctx,
      atlas,
      "glow",
      centerX,
      centerY,
      800,
      800,
      object.zIndex + 0.001,
      lightingQueue,
      { alpha: 0.5, tintColor: intToColor(0xffff50) }
    );
    if (getStoreValue(object, "energy") > 0) {
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 150, 150, object.zIndex + 0.002, lightingQueue, {
        alpha: 1,
      });
    }
    hasTexture = true;
  } else if (object.type === "spawn") {
    objectsQueue.push({ zIndex: object.zIndex + 0.01, draw: () => drawSpawnCore(ctx, object, gameTime) });
    if (getStoreValue(object, "energy") > 0) {
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 100, 100, object.zIndex + 0.001, lightingQueue, {
        alpha: 1,
      });
    }
    enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 600, 600, object.zIndex + 0.0005, lightingQueue, {
      alpha: 0.5,
    });
    hasTexture = true;
  } else if (object.type === "extension") {
    const energyCapacity = Math.max(0, getEnergyCapacity(object));
    const energy = getStoreValue(object, "energy");
    const size = energyCapacity >= 200 ? 100 : energyCapacity >= 100 ? 80 : 68;
    const borderAlias = energyCapacity >= 200 ? "extension-border200" : energyCapacity === 100 ? "extension-border100" : "extension-border50";
    enqueueAliasSprite(ctx, atlas, borderAlias, centerX, centerY, 100, 100, object.zIndex + 0.002, objectsQueue, {
      tintColor: object.ownerColor,
    });
    enqueueAliasSprite(ctx, atlas, "extension", centerX, centerY, size, size, object.zIndex + 0.003, objectsQueue);
    objectsQueue.push({
      zIndex: object.zIndex + 0.004,
      draw: () => {
        const scale = energyCapacity > 0 ? clamp(energy / energyCapacity, 0, 1) : 0;
        if (scale <= 0) {
          return;
        }
        ctx.beginPath();
        ctx.arc(centerX, centerY, size * 0.32 * scale, 0, TWO_PI);
        ctx.fillStyle = STORAGE_ENERGY_COLOR;
        ctx.fill();
      },
    });
    if (energy > 0) {
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 100, 100, object.zIndex + 0.001, lightingQueue, {
        alpha: 1,
      });
      const largeGlowSize = energyCapacity === 200 ? 250 : energyCapacity === 100 ? 220 : 200;
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, largeGlowSize, largeGlowSize, object.zIndex + 0.0008, lightingQueue, {
        alpha: 0.7,
      });
    }
    hasTexture = true;
  } else if (object.type === "terminal") {
    const resourcesTotal = getStoreTotal(object);
    const storeCapacity = getStoreCapacityValue(object, 300_000);
    const energy = getStoreValue(object, "energy");
    const power = getStoreValue(object, "power");
    const restResourceSize =
      resourcesTotal <= energy + power ? 0 : Math.min((76 * resourcesTotal) / Math.max(storeCapacity, 1), 76);
    const powerResourceSize = Math.min((76 * (energy + power)) / Math.max(storeCapacity, 1), 76);
    const energyResourceSize = Math.min((76 * energy) / Math.max(storeCapacity, 1), 76);
    const cooldownActive = typeof object.cooldownTime === "number" && object.cooldownTime >= gameTime;
    const highlightAlpha = cooldownActive ? 0.25 + 0.75 * (0.5 + Math.sin(gameTime * 8) * 0.5) : 0;
    enqueueAliasSprite(ctx, atlas, "terminal-border", centerX, centerY, 200, 200, object.zIndex + 0.001, objectsQueue, {
      tintColor: object.ownerColor,
    });
    enqueueAliasSprite(ctx, atlas, "terminal", centerX, centerY, 200, 200, object.zIndex + 0.002, objectsQueue);
    enqueueAliasSprite(
      ctx,
      atlas,
      "terminal-arrows",
      centerX,
      centerY,
      200,
      200,
      object.zIndex + 0.003,
      objectsQueue,
      { alpha: cooldownActive ? 0.1 : 1 }
    );
    if (cooldownActive) {
      enqueueAliasSprite(
        ctx,
        atlas,
        "terminal-highlight",
        centerX,
        centerY,
        200,
        200,
        object.zIndex + 0.004,
        effectsQueue,
        {
          alpha: highlightAlpha,
        }
      );
    }
    objectsQueue.push({
      zIndex: object.zIndex + 0.005,
      draw: () => {
        if (restResourceSize > 0) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(centerX - restResourceSize * 0.5, centerY - restResourceSize * 0.5, restResourceSize, restResourceSize);
        }
        if (powerResourceSize > 0) {
          ctx.fillStyle = STORAGE_POWER_COLOR;
          ctx.fillRect(centerX - powerResourceSize * 0.5, centerY - powerResourceSize * 0.5, powerResourceSize, powerResourceSize);
        }
        if (energyResourceSize > 0) {
          ctx.fillStyle = STORAGE_ENERGY_COLOR;
          ctx.fillRect(centerX - energyResourceSize * 0.5, centerY - energyResourceSize * 0.5, energyResourceSize, energyResourceSize);
        }
      },
    });
    if (resourcesTotal > 0) {
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 200, 200, object.zIndex + 0.0006, lightingQueue, {
        alpha: 1,
      });
    }
    enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 800, 800, object.zIndex + 0.0005, lightingQueue, { alpha: 0.5 });
    hasTexture = true;
  } else if (object.type === "container") {
    const resourcesTotal = getStoreTotal(object);
    const storeCapacity = getStoreCapacityValue(object, resourcesTotal || 1);
    const energy = getStoreValue(object, "energy");
    const power = getStoreValue(object, "power");
    const totalHeight = (50 * resourcesTotal) / Math.max(storeCapacity, 1);
    const powerHeight = (50 * (energy + power)) / Math.max(storeCapacity, 1);
    const energyHeight = (50 * energy) / Math.max(storeCapacity, 1);
    objectsQueue.push({
      zIndex: object.zIndex + 0.001,
      draw: () => {
        ctx.fillStyle = intToColor(0x181818);
        ctx.fillRect(centerX - 30, centerY - 35, 60, 70);
        ctx.fillStyle = intToColor(0x555555);
        ctx.fillRect(centerX - 20, centerY - 25, 40, 50);
        drawResourceBars(
          ctx,
          centerX,
          centerY + 25,
          40,
          totalHeight,
          energyHeight,
          powerHeight,
          resourcesTotal > energy + power
        );
      },
    });
    if (resourcesTotal > 0) {
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 100, 100, object.zIndex + 0.0005, lightingQueue, {
        alpha: 1,
      });
    }
    hasTexture = true;
  } else if (object.type === "tower") {
    const npc = isNpcOwner(object.user ?? object.owner);
    const energy = getStoreValue(object, "energy");
    const energyCapacity = Math.max(getEnergyCapacity(object), 1);
    const energyBarHeight = Math.min((66.7 * energy) / energyCapacity, 66.7);
    const energyBarRadius = Math.min(12, energyBarHeight * 0.5);
    const shotActive = Boolean(object.actionLog?.attack || object.actionLog?.heal || object.actionLog?.repair);
    enqueueAliasSprite(ctx, atlas, "tower-base", centerX, centerY, 200, 200, object.zIndex + 0.001, objectsQueue, {
      tintColor: object.ownerColor,
    });
    enqueueAliasSprite(
      ctx,
      atlas,
      npc ? "tower-rotatable-npc" : "tower-rotatable",
      centerX,
      centerY,
      115,
      115,
      object.zIndex + 0.002,
      objectsQueue,
      {
        rotation,
      }
    );
    if (!npc && energyBarHeight > 0) {
      objectsQueue.push({
        zIndex: object.zIndex + 0.003,
        draw: () => {
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(rotation);
          drawRoundedRectPath(ctx, -45, 0, 90, energyBarHeight, energyBarRadius);
          ctx.fillStyle = STORAGE_ENERGY_COLOR;
          ctx.fill();
          ctx.restore();
        },
      });
    }
    if (energy > 0) {
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 100, 100, object.zIndex + 0.0007, lightingQueue, {
        alpha: 1,
      });
    }
    enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 600, 600, object.zIndex + 0.0006, lightingQueue, { alpha: 0.5 });
    if (shotActive) {
      enqueueAliasSprite(ctx, atlas, "flare1", centerX, centerY, 400, 400, object.zIndex + 0.0009, effectsQueue, {
        alpha: 0.08 + 0.12 * (0.5 + Math.sin(gameTime * 18) * 0.5),
      });
    }
    hasTexture = true;
  } else if (object.type === "creep") {
    const npc = isNpcOwner(object.user ?? object.owner);
    if (npc) {
      enqueueAliasSprite(ctx, atlas, "creep-npc", centerX, centerY, 100, 100, object.zIndex + 0.001, objectsQueue);
      enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 100, 100, object.zIndex + 0.0007, lightingQueue, { alpha: 0.5 });
    } else {
      enqueueAliasSprite(ctx, atlas, "creep-mask", centerX, centerY, 100, 100, object.zIndex + 0.0008, lightingQueue);
    }
    enqueueAliasSprite(ctx, atlas, "glow", centerX, centerY, 400, 400, object.zIndex + 0.0006, lightingQueue, { alpha: 0.2 });
    hasTexture = true;
  }

  if (!useCustomRendering) {
    for (const layer of object.spec.textureLayers) {
      const layerRotation = object.type === "tower" && layer.alias.startsWith("tower-rotatable") ? rotation : 0;
      hasTexture =
        enqueueTexture(ctx, object, atlas, layer, layerRotation, objectsQueue, lightingQueue, effectsQueue) || hasTexture;
    }
  }

  if (object.type === "storage") {
    const resourcesTotal = getStoreTotal(object);
    const storeCapacity = getStoreCapacityValue(object, 1_000_000);
    const energy = getStoreValue(object, "energy");
    const power = getStoreValue(object, "power");
    const baseHeight = (140 * resourcesTotal) / Math.max(storeCapacity, resourcesTotal || 1);
    const powerHeight = (140 * (energy + power)) / Math.max(storeCapacity, resourcesTotal || 1);
    const energyHeight = (140 * energy) / Math.max(storeCapacity, resourcesTotal || 1);
    objectsQueue.push({
      zIndex: object.zIndex + 0.02,
      draw: () =>
        drawResourceBars(
          ctx,
          centerX,
          centerY + 70,
          110,
          baseHeight,
          energyHeight,
          powerHeight,
          resourcesTotal > energy + power
        ),
    });
  } else if (object.type === "factory") {
    const resourcesTotal = getStoreTotal(object);
    const storeCapacity = getStoreCapacityValue(object, 50_000);
    const energy = getStoreValue(object, "energy");
    const power = getStoreValue(object, "power");
    const baseHeight = (50 * resourcesTotal) / Math.max(storeCapacity, resourcesTotal || 1);
    const powerHeight = (50 * (energy + power)) / Math.max(storeCapacity, resourcesTotal || 1);
    const energyHeight = (50 * energy) / Math.max(storeCapacity, resourcesTotal || 1);
    objectsQueue.push({
      zIndex: object.zIndex + 0.02,
      draw: () => {
        ctx.fillStyle = intToColor(0x555555);
        ctx.fillRect(centerX - 25, centerY, 50, 50);
        if (baseHeight > 0) {
          drawResourceBars(
            ctx,
            centerX,
            centerY + 25,
            50,
            baseHeight,
            energyHeight,
            powerHeight,
            resourcesTotal > energy + power
          );
          ctx.fillStyle = FACTORY_ENERGY_COLOR;
          if (energyHeight > 0) {
            ctx.fillRect(centerX - 25, centerY + 25 - energyHeight, 50, energyHeight);
          }
        }
      },
    });
  } else if (object.type === "powerSpawn") {
    const energyScale = clamp(getStoreValue(object, "energy") / Math.max(getEnergyCapacity(object), 1), 0, 1);
    const powerCapacity = object.storeCapacityResource.power || 1;
    const powerRatio = clamp(getStoreValue(object, "power") / Math.max(powerCapacity, 1), 0, 1);
    objectsQueue.push({
      zIndex: object.zIndex + 0.01,
      draw: () => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 75, 0, TWO_PI);
        ctx.fillStyle = intToColor(0x222222);
        ctx.fill();
        ctx.lineWidth = 7;
        ctx.strokeStyle = intToColor(0xcccccc);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(centerX, centerY, 68, 0, TWO_PI);
        ctx.fillStyle = intToColor(0x222222);
        ctx.fill();
        ctx.lineWidth = 10;
        ctx.strokeStyle = STORAGE_POWER_COLOR;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(centerX, centerY, 59, 0, TWO_PI);
        ctx.fillStyle = intToColor(0x181818);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(centerX, centerY, 50, -Math.PI / 2, -Math.PI / 2 + TWO_PI * powerRatio);
        ctx.lineWidth = 10;
        ctx.strokeStyle = STORAGE_POWER_COLOR;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(centerX, centerY, 38 * energyScale, 0, TWO_PI);
        ctx.fillStyle = STORAGE_ENERGY_COLOR;
        ctx.fill();
      },
    });
  }

  if (!hasTexture) {
    objectsQueue.push({
      zIndex: object.zIndex,
      draw: () => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 27, 0, TWO_PI);
        ctx.fillStyle = OBJECT_BASE_COLORS[object.type] ?? object.ownerColor;
        ctx.fill();
      },
    });
  }

  if (object.type === "constructionSite" && object.progressTotal && object.progressTotal > 0) {
    objectsQueue.push({
      zIndex: object.zIndex + 0.02,
      draw: () => {
        const ratio = clamp((object.progress ?? 0) / object.progressTotal!, 0, 1);
        ctx.beginPath();
        ctx.arc(centerX, centerY, 25, 0, TWO_PI);
        ctx.lineWidth = 10;
        ctx.strokeStyle = object.ownerColor;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, 20, -Math.PI / 2, -Math.PI / 2 + TWO_PI * ratio);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();
      },
    });
  }

  if (object.type === "creep" || object.type === "powerCreep") {
    uiQueue.push({ zIndex: object.zIndex + 0.03, draw: () => drawCreepBodyAndSay(ctx, object, atlas) });
  } else if (object.say) {
    uiQueue.push({ zIndex: object.zIndex + 0.03, draw: () => drawCreepBodyAndSay(ctx, object, atlas) });
  }

  if (object.actionLog) {
    effectsQueue.push({
      zIndex: object.zIndex + 0.05,
      draw: () => drawActionLog(ctx, object, atlas, gameTime),
    });
  }

  if (object.type === "rampart" && object.isPublic) {
    effectsQueue.push({
      zIndex: object.zIndex + 0.02,
      draw: () => {
        const centerX = object.x * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
        const centerY = object.y * CELL_WORLD_SIZE + CELL_WORLD_SIZE * 0.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 42, 0, TWO_PI);
        ctx.strokeStyle = "rgba(150,230,180,0.7)";
        ctx.lineWidth = 4;
        ctx.stroke();
      },
    });
  }
}

function flushQueue(
  ctx: CanvasRenderingContext2D,
  queue: QueueItem[],
  blendMode: GlobalCompositeOperation = "source-over"
): void {
  if (queue.length === 0) {
    return;
  }
  queue.sort((left, right) => left.zIndex - right.zIndex);
  ctx.save();
  ctx.globalCompositeOperation = blendMode;
  for (const item of queue) {
    item.draw();
  }
  ctx.restore();
}

function renderLightingLayer(
  ctx: CanvasRenderingContext2D,
  queue: QueueItem[],
  camera: CameraState,
  displayWidth: number,
  displayHeight: number
): void {
  const width = Math.max(1, Math.floor(displayWidth));
  const height = Math.max(1, Math.floor(displayHeight));
  const buffer = getLightingBuffer(width, height);
  if (!buffer) {
    flushQueue(ctx, queue, "screen");
    return;
  }

  const lightingCtx = buffer.ctx;
  lightingCtx.setTransform(1, 0, 0, 1, 0, 0);
  lightingCtx.clearRect(0, 0, width, height);
  lightingCtx.fillStyle = "#808080";
  lightingCtx.fillRect(0, 0, width, height);
  lightingCtx.save();
  lightingCtx.translate(camera.offsetX, camera.offsetY);
  lightingCtx.scale(camera.zoom, camera.zoom);
  lightingCtx.imageSmoothingEnabled = true;
  flushQueue(lightingCtx, queue, "screen");
  lightingCtx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(buffer.canvas, 0, 0, width, height);
  ctx.restore();
}

export function renderOfficialStyleScene({
  ctx,
  displayWidth,
  displayHeight,
  camera,
  terrainCanvas,
  atlas,
  objects,
  gameTime,
}: RenderOfficialStyleSceneParams): void {
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = "#080d12";
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  ctx.save();
  ctx.translate(camera.offsetX, camera.offsetY);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = "#555555";
  ctx.fillRect(0, 0, ROOM_VIEW_BOX, ROOM_VIEW_BOX);

  const groundTexture = atlas.get("ground");
  if (groundTexture) {
    fillPatternLayer(ctx, groundTexture, 0.3, 3, "source-over");
  }

  const terrainVectorRendered = drawTerrainVectorLayer(ctx, terrainCanvas, atlas);
  const groundMask = atlas.get("ground-mask");
  if (groundMask) {
    fillPatternLayer(ctx, groundMask, 0.15, 7, "multiply");
  }

  if (!terrainVectorRendered && terrainCanvas) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainCanvas, 0, 0, GRID_SIZE, GRID_SIZE, 0, 0, ROOM_VIEW_BOX, ROOM_VIEW_BOX);
    ctx.restore();
  }

  const minWorldX = (-camera.offsetX) / camera.zoom - CELL_WORLD_SIZE;
  const minWorldY = (-camera.offsetY) / camera.zoom - CELL_WORLD_SIZE;
  const maxWorldX = (displayWidth - camera.offsetX) / camera.zoom + CELL_WORLD_SIZE;
  const maxWorldY = (displayHeight - camera.offsetY) / camera.zoom + CELL_WORLD_SIZE;

  const roads = buildRoadSet(objects);
  const objectsQueue: QueueItem[] = [];
  const lightingQueue: QueueItem[] = [];
  const effectsQueue: QueueItem[] = [];
  const uiQueue: QueueItem[] = [];

  for (const object of objects) {
    const worldLeft = object.x * CELL_WORLD_SIZE;
    const worldTop = object.y * CELL_WORLD_SIZE;
    if (
      worldLeft > maxWorldX ||
      worldTop > maxWorldY ||
      worldLeft + CELL_WORLD_SIZE < minWorldX ||
      worldTop + CELL_WORLD_SIZE < minWorldY
    ) {
      continue;
    }
    drawObject(ctx, object, atlas, roads, gameTime, objectsQueue, lightingQueue, effectsQueue, uiQueue);
  }

  flushQueue(ctx, objectsQueue, "source-over");
  renderLightingLayer(ctx, lightingQueue, camera, displayWidth, displayHeight);
  flushQueue(ctx, effectsQueue, "source-over");
  flushQueue(ctx, uiQueue, "source-over");
  ctx.restore();
}
