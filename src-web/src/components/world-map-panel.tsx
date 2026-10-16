import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useMapPointerGestures, useMapWheelZoom } from "./map-gestures";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  clearWorldMapRoomCache,
  fetchWorldMapOwnRooms,
  fetchWorldMapRooms,
  fetchWorldRoomScene,
  formatWorldRoomName,
  isHighwayRoom,
  normalizeWorldRoomName,
  parseWorldRoomName,
  type WorldMapAuthContext,
} from "../lib/screeps/world-map";
import { useServerShards } from "../lib/screeps/shards";
import { normalizeBaseUrl } from "../lib/screeps/request";
import type { WorldRoomStat } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";

/**
 * World map.
 *
 * The canvas stays deliberately simple (flat tiles, no rAF dependency) while
 * the useful information lives in four layers:
 *   1. Level-of-detail tiles: owner colour + RCL brightness, with room names,
 *      RCL badges and owner labels appearing as you zoom in.
 *   2. Real room snapshots: once a tile is big enough the official Screeps
 *      renderer draws the actual room (terrain, structures, creeps) into it.
 *   3. A cursor tooltip plus a click-to-pin inspector, so a room can be read
 *      without leaving the map.
 *   4. Side lists: players in the loaded region and your own rooms, both
 *      clickable to centre and/or highlight.
 */

const DEFAULT_SERVER_URL = "https://screeps.com";

/* -------------------------------------------------------------------------- *
 * Official-renderer room previews
 * -------------------------------------------------------------------------- */

/** Below this tile size a room snapshot is unreadable, so flat colours win. */
const PREVIEW_MIN_CELL = 64;
/** Rooms rendered per scheduler tick; keeps the shared renderer responsive. */
const PREVIEW_MAX_PER_PASS = 6;
/** How often the scheduler looks for newly eligible rooms. */
const PREVIEW_TICK_MS = 700;
/** Snapshots are refreshed after this long so the map does not go stale. */
const PREVIEW_TTL_MS = 4 * 60 * 1000;
/** Backoff after a room fails to load/render. */
const PREVIEW_RETRY_MS = 45 * 1000;
/** Upper bound on retained snapshots (each is a 512x512 canvas). */
const PREVIEW_CACHE_LIMIT = 96;
/** Safety bound on the per-tick candidate scan. */
const PREVIEW_MAX_CANDIDATES = 240;

interface RoomPreviewEntry {
  canvas: HTMLCanvasElement;
  at: number;
}

type PreviewStatus = "idle" | "ready" | "unavailable";

type RoomPreviewModule = typeof import("./official-room-preview");

let previewModulePromise: Promise<RoomPreviewModule> | null = null;

/** Loads the renderer bridge lazily so `/map` does not pull in Pixi up front. */
function loadPreviewModule(): Promise<RoomPreviewModule> {
  if (!previewModulePromise) {
    previewModulePromise = import("./official-room-preview");
  }
  return previewModulePromise;
}

/** Room cell size at zoom 1, in CSS pixels. */
const CELL_BASE_PX = 20;
const ABS_MIN_ZOOM = 0.2;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.25;
/** Upper bound on tiles drawn per frame so panning stays smooth. */
const MAX_DRAW_ROOMS = 30_000;
/** Upper bound on rooms requested per refresh (centre of the view first). */
const MAX_REQUEST_ROOMS = 800;
/** Candidate pool used to keep loading rooms at the edge of the view. */
const REQUEST_CANDIDATE_FACTOR = 4;
const FETCH_DEBOUNCE_MS = 220;
const STATS_POLL_MS = 45_000;
const FAILURE_BACKOFF_MS = 12_000;
const MINIMAP_SIZE = 168;
/** Rooms covered by the minimap across its full width. */
const MINIMAP_SPAN = 180;

/** Level-of-detail thresholds, in CSS pixels per room. */
const GRID_MIN_CELL = 7;
const NAME_MIN_CELL = 19;
const LEVEL_MIN_CELL = 26;
const OWNER_MIN_CELL = 36;
/** Above this many tiles per frame, text labels are skipped for performance. */
const LABEL_CELL_BUDGET = 6_000;

const COLOR_BACKGROUND = "#070b10";
const COLOR_UNKNOWN_ROOM = "#0d141d";
const COLOR_EMPTY_ROOM = "#1b2735";
const COLOR_HIGHWAY_ROOM = "#141d29";
const COLOR_GRID_LINE = "rgba(148, 176, 214, 0.10)";
const COLOR_HIGHWAY_LINE = "rgba(122, 158, 205, 0.32)";
const COLOR_NOVICE = "#2b4f6e";
const COLOR_RESPAWN = "#54306f";
const COLOR_SELECTED = "#ffd166";
const COLOR_MINE = "#3ce07c";
const COLOR_ORIGIN = "#f4d35e";
const COLOR_TEXT = "rgba(236, 243, 252, 0.94)";
const COLOR_TEXT_DIM = "rgba(170, 192, 216, 0.62)";

const OWNER_DIM_ALPHA = 0.26;

interface CameraState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface HoverTarget {
  name: string;
  left: number;
  top: number;
  size: number;
}

interface PlayerSummary {
  key: string;
  name: string;
  rooms: number;
  maxLevel: number | undefined;
}

/** Resolved room data for the inspector/tooltip, held outside the canvas cache. */
type RoomInfo = { stat: WorldRoomStat | null; loaded: boolean } | null;

interface MinimapView {
  centerWorldX: number;
  centerWorldY: number;
  scale: number;
}

interface LayerState {
  names: boolean;
  owners: boolean;
  levels: boolean;
  grid: boolean;
  highways: boolean;
  special: boolean;
  ownRooms: boolean;
  previews: boolean;
}

const DEFAULT_LAYERS: LayerState = {
  names: true,
  owners: true,
  levels: true,
  grid: true,
  highways: true,
  special: true,
  ownRooms: true,
  previews: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** FNV-1a; used to give every owner a stable colour. */
function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Golden-angle hue spreading keeps neighbouring ids visually distinct. */
function ownerHue(value: string): number {
  return (hashSeed(value) * 137.508) % 360;
}

function ownerColor(key: string, level: number | undefined): string {
  const hue = ownerHue(key);
  const lightness = 30 + clamp((level ?? 1) / 8, 0, 1) * 22;
  return `hsl(${hue.toFixed(1)} 58% ${lightness.toFixed(1)}%)`;
}

function ownerKeyOf(stat: WorldRoomStat | undefined): string | undefined {
  if (!stat?.owner) {
    return undefined;
  }
  return stat.ownerId ?? stat.owner;
}

function roomNameAt(x: number, y: number): string {
  return formatWorldRoomName({ x, y });
}

function computeMinZoom(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return ABS_MIN_ZOOM;
  }
  const baseRooms = (width / CELL_BASE_PX) * (height / CELL_BASE_PX);
  if (baseRooms <= MAX_DRAW_ROOMS) {
    return ABS_MIN_ZOOM;
  }
  return clamp(Math.sqrt(baseRooms / MAX_DRAW_ROOMS), ABS_MIN_ZOOM, MAX_ZOOM);
}

/** Screen-space top-left corner of a room tile. */
function roomScreenOrigin(camera: CameraState, x: number, y: number) {
  const cell = CELL_BASE_PX * camera.zoom;
  return {
    left: camera.offsetX + x * cell,
    top: camera.offsetY - (y + 1) * cell,
    cell,
  };
}

/** Room under a point, in viewport-local CSS pixels. */
function roomAtPoint(camera: CameraState, px: number, py: number): { x: number; y: number } {
  const cell = CELL_BASE_PX * camera.zoom;
  return {
    x: Math.floor((px - camera.offsetX) / cell),
    y: Math.ceil((camera.offsetY - py) / cell) - 1,
  };
}

function visibleBounds(camera: CameraState, width: number, height: number): Bounds {
  const cell = CELL_BASE_PX * camera.zoom;
  return {
    minX: Math.floor(-camera.offsetX / cell),
    maxX: Math.floor((width - camera.offsetX) / cell),
    minY: Math.floor((camera.offsetY - height) / cell),
    maxY: Math.floor(camera.offsetY / cell),
  };
}

export function WorldMapPanel() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const servers = useSettingsStore((state) => state.servers);
  const activeServerId = useSettingsStore((state) => state.activeServerId);

  /**
   * Guests and anonymous visitors still get a world map: prefer the active
   * session, otherwise fall back to the server selected in settings.
   */
  const authContext: WorldMapAuthContext = useMemo(() => {
    const fallbackServer = servers.find((server) => server.id === activeServerId) ?? servers[0];
    const rawBaseUrl = session?.baseUrl?.trim() || fallbackServer?.baseUrl || DEFAULT_SERVER_URL;
    return {
      baseUrl: normalizeBaseUrl(rawBaseUrl),
      token: session?.token?.trim() ? session.token : undefined,
      username: session?.username?.trim() ? session.username : undefined,
    };
  }, [activeServerId, servers, session?.baseUrl, session?.token, session?.username]);

  // Shards are resolved from the same auth context so guests get the picker too.
  const { shards: sessionShards, loading: sessionShardsLoading } = useServerShards(session);
  const { shards: guestShards, loading: guestShardsLoading } = useServerShards(
    session ? null : authContext
  );
  const shardOptions = session ? sessionShards : guestShards;
  const shardsBusy = session ? sessionShardsLoading : guestShardsLoading;

  const currentUser = authContext.username?.toLowerCase() ?? "";

  /* ------------------------------------------------------------------ *
   * Refs
   * ------------------------------------------------------------------ */

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);

  const cameraRef = useRef<CameraState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const viewportSizeRef = useRef<ViewportSize>({ width: 0, height: 0 });
  const minZoomRef = useRef(ABS_MIN_ZOOM);
  /** Latest shard, readable from async loads that were scheduled earlier. */
  const shardRef = useRef("");
  /** Latest server, so in-flight loads can detect a server switch. */
  const authBaseUrlRef = useRef("");

  const statsRef = useRef<Map<string, WorldRoomStat>>(new Map());
  const resolvedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef(0);
  const lastFailureRef = useRef(0);

  const hydratedRef = useRef(false);
  const interactedRef = useRef(false);
  const dragDistanceRef = useRef(0);
  const hoverNameRef = useRef<string | null>(null);
  const minimapDraggingRef = useRef(false);
  const minimapViewRef = useRef<MinimapView | null>(null);
  const loadTimerRef = useRef<number | null>(null);

  /** Late-bound callbacks, so camera helpers never capture stale closures. */
  const loadFnRef = useRef<() => void>(() => {});
  const loadVisibleRef = useRef<(options?: { refresh?: boolean }) => void>(() => {});
  const scheduleLoadRef = useRef<() => void>(() => {});
  const scheduleDrawRef = useRef<() => void>(() => {});
  const drawMinimapRef = useRef<() => void>(() => {});
  const resetViewRef = useRef<() => void>(() => {});

  /** Official-renderer snapshots, keyed by `shard|room`. */
  const previewCacheRef = useRef<Map<string, RoomPreviewEntry>>(new Map());
  const previewPendingRef = useRef<Set<string>>(new Set());
  const previewRetryRef = useRef<Map<string, number>>(new Map());
  /** Bumped on shard/server change or unmount so stale batches are dropped. */
  const previewGenerationRef = useRef(0);
  const previewModuleUsedRef = useRef(false);
  const previewEnabledRef = useRef(true);
  const previewAuthRef = useRef<WorldMapAuthContext>(authContext);

  const hudRef = useRef({ center: "", visible: -1, loaded: -1, owned: -1 });

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [shard, setShard] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [highlightOwner, setHighlightOwner] = useState<string | null>(null);
  const [ownRoomNames, setOwnRoomNames] = useState<string[]>([]);
  const [statsVersion, setStatsVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [centerRoom, setCenterRoom] = useState("");
  const [visibleRooms, setVisibleRooms] = useState(0);
  const [loadedRooms, setLoadedRooms] = useState(0);
  const [ownedRooms, setOwnedRooms] = useState(0);
  const [gameTime, setGameTime] = useState<number | null>(null);

  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [selectedInfo, setSelectedInfo] = useState<RoomInfo>(null);
  const [hoverInfo, setHoverInfo] = useState<RoomInfo>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewCount, setPreviewCount] = useState(0);

  previewEnabledRef.current = layers.previews;
  previewAuthRef.current = authContext;

  /** Recomputes the side lists from the room cache. Never called during render. */
  const publishDerived = useCallback(() => {
    const grouped = new Map<string, PlayerSummary>();
    for (const stat of statsRef.current.values()) {
      const key = ownerKeyOf(stat);
      if (!key || !stat.owner) {
        continue;
      }
      const existing = grouped.get(key);
      if (existing) {
        existing.rooms += 1;
        if (stat.level !== undefined) {
          existing.maxLevel = Math.max(existing.maxLevel ?? 0, stat.level);
        }
      } else {
        grouped.set(key, { key, name: stat.owner, rooms: 1, maxLevel: stat.level });
      }
    }
    setPlayers(
      [...grouped.values()].sort(
        (left, right) => right.rooms - left.rooms || left.name.localeCompare(right.name)
      )
    );
    setTotalLoaded(statsRef.current.size);
  }, []);

  const ownRoomSet = useMemo(() => new Set(ownRoomNames), [ownRoomNames]);
  const minZoom = useMemo(
    () => computeMinZoom(viewportSize.width, viewportSize.height),
    [viewportSize]
  );
  minZoomRef.current = minZoom;
  shardRef.current = shard;
  authBaseUrlRef.current = authContext.baseUrl;

  /**
   * Values the renderer reads. Keeping them in one ref means `draw` never has
   * to be re-created and never captures stale state.
   */
  const renderRef = useRef({
    layers,
    highlightOwner,
    selected,
    ownRoomSet,
    currentUser,
    safeModeLabel: t("map.safeModeShort"),
    shard,
    previews: previewCacheRef.current,
  });
  renderRef.current = {
    layers,
    highlightOwner,
    selected,
    ownRoomSet,
    currentUser,
    safeModeLabel: t("map.safeModeShort"),
    shard,
    previews: previewCacheRef.current,
  };

  /* ------------------------------------------------------------------ *
   * Drawing
   * ------------------------------------------------------------------ */

  const drawChip = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      size: number,
      color: string
    ) => {
      ctx.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      const width = ctx.measureText(text).width + 6;
      ctx.fillStyle = "rgba(4, 8, 13, 0.66)";
      ctx.fillRect(x - width, y - 1, width, size + 3);
      ctx.fillStyle = color;
      ctx.fillText(text, x - 3, y);
    },
    []
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const { width, height } = viewportSizeRef.current;
    if (!canvas || !ctx || width <= 0 || height <= 0) {
      return;
    }

    const dpr = clamp(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 1, 2);
    const backingWidth = Math.floor(width * dpr);
    const backingHeight = Math.floor(height * dpr);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const camera = cameraRef.current;
    const {
      layers: activeLayers,
      highlightOwner: highlighted,
      selected: selectedName,
      ownRoomSet: ownRooms,
      currentUser: viewer,
      safeModeLabel,
      shard: activeShard,
      previews: previewCache,
    } = renderRef.current;

    const cell = CELL_BASE_PX * camera.zoom;
    const bounds = visibleBounds(camera, width, height);
    const stats = statsRef.current;
    const resolved = resolvedRef.current;
    const totalCells = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
    const labelsAllowed = totalCells <= LABEL_CELL_BUDGET;

    const showNames = activeLayers.names && labelsAllowed && cell >= NAME_MIN_CELL;
    const showLevels = activeLayers.levels && labelsAllowed && cell >= LEVEL_MIN_CELL;
    const showOwners = activeLayers.owners && labelsAllowed && cell >= OWNER_MIN_CELL;
    const showSpecial = activeLayers.special;

    /* Pass A: tile fills. */
    let loadedCount = 0;
    let ownedCount = 0;
    for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
      const top = camera.offsetY - (y + 1) * cell;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const left = camera.offsetX + x * cell;
        const name = roomNameAt(x, y);
        const stat = stats.get(name);
        const key = ownerKeyOf(stat);
        const known = stat !== undefined || resolved.has(name);

        let fill: string;
        if (stat?.owner && key) {
          fill = ownerColor(key, stat.level);
          ownedCount += 1;
        } else if (stat && showSpecial && stat.respawnArea) {
          fill = COLOR_RESPAWN;
        } else if (stat && showSpecial && stat.novice) {
          fill = COLOR_NOVICE;
        } else if (known) {
          fill = isHighwayRoom({ x, y }) ? COLOR_HIGHWAY_ROOM : COLOR_EMPTY_ROOM;
        } else {
          fill = COLOR_UNKNOWN_ROOM;
        }
        if (known) {
          loadedCount += 1;
        }

        const dimmed =
          highlighted !== null && key !== highlighted && fill !== COLOR_UNKNOWN_ROOM;
        ctx.globalAlpha = dimmed ? OWNER_DIM_ALPHA : 1;
        ctx.fillStyle = fill;
        // +0.5 avoids hairline gaps between tiles at fractional cell sizes.
        ctx.fillRect(left, top, cell + 0.5, cell + 0.5);
      }
    }
    ctx.globalAlpha = 1;

    /* Pass A2: real room snapshots, once tiles are big enough to read them. */
    if (activeLayers.previews && previewCache.size > 0 && cell >= PREVIEW_MIN_CELL) {
      for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
        const top = camera.offsetY - (y + 1) * cell;
        if (top > height || top + cell < 0) {
          continue;
        }
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          const left = camera.offsetX + x * cell;
          if (left > width || left + cell < 0) {
            continue;
          }
          const entry = previewCache.get(`${activeShard}|${roomNameAt(x, y)}`);
          if (!entry) {
            continue;
          }
          const stat = stats.get(roomNameAt(x, y));
          const key = ownerKeyOf(stat);
          const dimmed = highlighted !== null && key !== highlighted;
          ctx.globalAlpha = dimmed ? OWNER_DIM_ALPHA : 1;
          ctx.drawImage(entry.canvas, left, top, cell + 0.5, cell + 0.5);
        }
      }
      ctx.globalAlpha = 1;
    }

    /* Pass B: grid and highway guides on top of the tiles. */
    if (activeLayers.grid && cell >= GRID_MIN_CELL) {
      ctx.strokeStyle = COLOR_GRID_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = bounds.minX; x <= bounds.maxX + 1; x += 1) {
        const px = Math.round(camera.offsetX + x * cell) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = bounds.minY; y <= bounds.maxY + 1; y += 1) {
        const py = Math.round(camera.offsetY - y * cell) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.stroke();
    }

    if (activeLayers.highways) {
      ctx.strokeStyle = COLOR_HIGHWAY_LINE;
      ctx.lineWidth = clamp(cell * 0.14, 1, 3);
      ctx.beginPath();
      for (let x = Math.ceil(bounds.minX / 10) * 10; x <= bounds.maxX; x += 10) {
        const px = Math.round(camera.offsetX + x * cell) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = Math.ceil(bounds.minY / 10) * 10; y <= bounds.maxY; y += 10) {
        const py = Math.round(camera.offsetY - y * cell) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.stroke();
    }

    /* Pass C: rings and labels. */
    const nameFontSize = clamp(cell * 0.3, 9, 12);
    const ownerFontSize = clamp(cell * 0.26, 10, 13);
    const labelPad = Math.max(2, cell * 0.08);

    for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
      const top = camera.offsetY - (y + 1) * cell;
      if (top > height || top + cell < 0) {
        continue;
      }
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const left = camera.offsetX + x * cell;
        if (left > width || left + cell < 0) {
          continue;
        }

        const name = roomNameAt(x, y);
        const stat = stats.get(name);
        const key = ownerKeyOf(stat);
        const mine = viewer.length > 0 && stat?.owner?.toLowerCase() === viewer;

        if (activeLayers.ownRooms && (mine || ownRooms.has(name))) {
          ctx.strokeStyle = COLOR_MINE;
          ctx.lineWidth = clamp(cell * 0.1, 1.5, 3);
          ctx.strokeRect(left + 1, top + 1, cell - 2, cell - 2);
        } else if (highlighted !== null && key === highlighted) {
          ctx.strokeStyle = COLOR_TEXT;
          ctx.lineWidth = clamp(cell * 0.08, 1.2, 2);
          ctx.strokeRect(left + 1, top + 1, cell - 2, cell - 2);
        }

        if (stat?.safeMode && cell >= LEVEL_MIN_CELL) {
          drawChip(ctx, safeModeLabel, left + cell - labelPad, top + labelPad, 9, COLOR_SELECTED);
        }

        if (stat?.level !== undefined && showLevels) {
          const chipSize = clamp(cell * 0.34, 13, 17);
          const cx = left + cell - labelPad - chipSize / 2;
          const cy = top + cell - labelPad - chipSize / 2;
          ctx.fillStyle = "rgba(4, 8, 13, 0.72)";
          ctx.beginPath();
          ctx.arc(cx, cy, chipSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLOR_TEXT;
          ctx.font = `700 ${clamp(chipSize * 0.66, 9, 12)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${stat.level}`, cx, cy + 0.5);
        }

        if (showOwners && stat?.owner) {
          ctx.fillStyle = COLOR_TEXT;
          ctx.font = `600 ${ownerFontSize}px system-ui, -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(stat.owner, left + cell / 2, top + cell * 0.4, cell - labelPad * 2);
        }

        if (showNames) {
          ctx.fillStyle = COLOR_TEXT_DIM;
          ctx.font = `600 ${nameFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(name, left + labelPad, top + cell - labelPad, cell - labelPad * 2);
        }

        if (name === selectedName) {
          ctx.strokeStyle = COLOR_SELECTED;
          ctx.lineWidth = clamp(cell * 0.14, 2, 4);
          ctx.strokeRect(left + 1, top + 1, cell - 2, cell - 2);
        }
      }
    }

    /* Origin cross-hair keeps the otherwise flat grid oriented. */
    const originX = camera.offsetX;
    const originY = camera.offsetY;
    ctx.strokeStyle = COLOR_ORIGIN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(originX, Math.max(0, originY - 14));
    ctx.lineTo(originX, Math.min(height, originY + 14));
    ctx.moveTo(Math.max(0, originX - 14), originY);
    ctx.lineTo(Math.min(width, originX + 14), originY);
    ctx.stroke();

    /* HUD values, only pushed to React when they actually change. */
    const hud = hudRef.current;
    const centerX = Math.floor((width / 2 - camera.offsetX) / cell);
    const centerY = Math.ceil((camera.offsetY - height / 2) / cell) - 1;
    const centerName = roomNameAt(centerX, centerY);
    if (hud.center !== centerName) {
      hud.center = centerName;
      setCenterRoom(centerName);
    }
    if (hud.visible !== totalCells) {
      hud.visible = totalCells;
      setVisibleRooms(totalCells);
    }
    if (hud.loaded !== loadedCount) {
      hud.loaded = loadedCount;
      setLoadedRooms(loadedCount);
    }
    if (hud.owned !== ownedCount) {
      hud.owned = ownedCount;
      setOwnedRooms(ownedCount);
    }

    drawMinimapRef.current();
  }, [drawChip]);

  const scheduleDraw = useCallback(() => {
    // Synchronous redraw: the world map is a plain 2D canvas, so it must not
    // depend on requestAnimationFrame (browsers pause rAF for hidden windows).
    draw();
  }, [draw]);

  scheduleDrawRef.current = scheduleDraw;

  /* ------------------------------------------------------------------ *
   * Room previews (official renderer snapshots)
   * ------------------------------------------------------------------ */

  /** Drops the oldest snapshots once the cache grows past its limit. */
  const trimPreviewCache = useCallback(() => {
    const cache = previewCacheRef.current;
    if (cache.size <= PREVIEW_CACHE_LIMIT) {
      return;
    }
    const overflow = cache.size - PREVIEW_CACHE_LIMIT;
    const oldest = [...cache.entries()]
      .sort((left, right) => left[1].at - right[1].at)
      .slice(0, overflow);
    for (const [key] of oldest) {
      cache.delete(key);
    }
  }, []);

  /**
   * Renders a batch of rooms one at a time.
   *
   * The official renderer is a single shared, non-reentrant instance, so rooms
   * are drawn strictly in sequence; a room that fails is retried after a
   * backoff instead of blocking the queue. `generation` guards against a shard
   * or server switch landing stale snapshots in the cache.
   */
  const runPreviewBatch = useCallback(
    async (keys: string[], generation: number, auth: WorldMapAuthContext, shard: string) => {
      let module: RoomPreviewModule;
      try {
        module = await loadPreviewModule();
      } catch {
        for (const key of keys) {
          previewPendingRef.current.delete(key);
        }
        setPreviewStatus("unavailable");
        return;
      }
      previewModuleUsedRef.current = true;
      module.configureRoomPreviewRenderer({
        badgeUrl: module.buildRoomPreviewBadgeUrl(auth.baseUrl),
        lighting: "normal",
      });

      let rendered = 0;
      for (const key of keys) {
        if (generation !== previewGenerationRef.current) {
          previewPendingRef.current.delete(key);
          continue;
        }
        const room = key.slice(key.indexOf("|") + 1);
        try {
          const scene = await fetchWorldRoomScene(auth, room, shard);
          if (!scene) {
            throw new Error("no scene data");
          }
          if (generation !== previewGenerationRef.current) {
            continue;
          }
          const canvas = await module.renderRoomPreview({
            room: scene.room,
            terrainEncoded: scene.terrainEncoded,
            officialObjects: scene.officialObjects,
            officialUsers: scene.officialUsers,
            gameTime: scene.gameTime,
            currentUsername: auth.username ?? undefined,
          });
          if (!canvas) {
            throw new Error("render failed");
          }
          if (generation !== previewGenerationRef.current) {
            continue;
          }
          previewCacheRef.current.set(key, { canvas, at: Date.now() });
          previewRetryRef.current.delete(key);
          rendered += 1;
        } catch {
          previewRetryRef.current.set(key, Date.now() + PREVIEW_RETRY_MS);
        } finally {
          previewPendingRef.current.delete(key);
        }
      }

      if (rendered > 0) {
        trimPreviewCache();
        setPreviewCount(previewCacheRef.current.size);
        if (!module.isRoomPreviewSupported()) {
          setPreviewStatus("unavailable");
        } else {
          setPreviewStatus("ready");
        }
        scheduleDrawRef.current();
        drawMinimapRef.current();
      }
    },
    [trimPreviewCache]
  );

  /** Schedules snapshots for the rooms closest to the viewport centre. */
  const pumpPreviews = useCallback(() => {
    if (!previewEnabledRef.current) {
      return;
    }
    const { width, height } = viewportSizeRef.current;
    if (width <= 0 || height <= 0) {
      return;
    }
    const camera = cameraRef.current;
    const cell = CELL_BASE_PX * camera.zoom;
    if (cell < PREVIEW_MIN_CELL) {
      return;
    }

    const shard = shardRef.current;
    const cache = previewCacheRef.current;
    const pending = previewPendingRef.current;
    const retries = previewRetryRef.current;
    const now = Date.now();
    const bounds = visibleBounds(camera, width, height);
    const centre = roomAtPoint(camera, width / 2, height / 2);

    const candidates: Array<{ key: string; distance: number }> = [];
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const key = `${shard}|${roomNameAt(x, y)}`;
        const cached = cache.get(key);
        if (cached && now - cached.at < PREVIEW_TTL_MS) {
          continue;
        }
        if (pending.has(key)) {
          continue;
        }
        const retryAt = retries.get(key);
        if (retryAt !== undefined && now < retryAt) {
          continue;
        }
        const dx = x - centre.x;
        const dy = y - centre.y;
        candidates.push({ key, distance: dx * dx + dy * dy });
        if (candidates.length >= PREVIEW_MAX_CANDIDATES) {
          break;
        }
      }
      if (candidates.length >= PREVIEW_MAX_CANDIDATES) {
        break;
      }
    }

    if (candidates.length === 0) {
      return;
    }
    candidates.sort((left, right) => left.distance - right.distance);
    const batch = candidates.slice(0, PREVIEW_MAX_PER_PASS);
    for (const item of batch) {
      pending.add(item.key);
    }
    void runPreviewBatch(
      batch.map((item) => item.key),
      previewGenerationRef.current,
      previewAuthRef.current,
      shard
    );
  }, [runPreviewBatch]);

  /** Drops every cached snapshot and invalidates in-flight batches. */
  const resetPreviews = useCallback(
    (options: { release?: boolean } = {}) => {
      previewGenerationRef.current += 1;
      previewCacheRef.current.clear();
      previewPendingRef.current.clear();
      previewRetryRef.current.clear();
      setPreviewCount(0);
      setPreviewStatus("idle");
      if (options.release && previewModuleUsedRef.current) {
        void loadPreviewModule()
          .then((module) => module.disposeRoomPreviewRenderer())
          .catch(() => undefined);
      }
    },
    []
  );

  // Snapshots belong to one shard/server: dropping them avoids showing rooms
  // from a world the user has already left.
  useEffect(() => {
    resetPreviews();
    // `resetPreviews` is stable, and the base URL is what identifies a server.
  }, [resetPreviews, shard, authContext.baseUrl]);

  // The scheduler only runs while the layer is on and the tiles are large.
  useEffect(() => {
    if (!layers.previews) {
      return;
    }
    const timer = window.setInterval(pumpPreviews, PREVIEW_TICK_MS);
    pumpPreviews();
    return () => {
      window.clearInterval(timer);
    };
  }, [layers.previews, pumpPreviews]);

  // Turning the layer off releases the shared WebGL renderer.
  useEffect(() => {
    if (layers.previews) {
      return;
    }
    resetPreviews({ release: true });
    scheduleDrawRef.current();
  }, [layers.previews, resetPreviews]);

  // Releasing on unmount keeps the number of WebGL contexts at one.
  useEffect(
    () => () => {
      previewGenerationRef.current += 1;
      if (previewModuleUsedRef.current) {
        void loadPreviewModule()
          .then((module) => module.disposeRoomPreviewRenderer())
          .catch(() => undefined);
      }
    },
    []
  );

  const drawMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    const ctx = canvas?.getContext("2d");
    const { width, height } = viewportSizeRef.current;
    if (!canvas || !ctx || width <= 0 || height <= 0) {
      return;
    }

    const dpr = clamp(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 1, 2);
    const backing = Math.floor(MINIMAP_SIZE * dpr);
    if (canvas.width !== backing) {
      canvas.width = backing;
      canvas.height = backing;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#060a0f";
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    const camera = cameraRef.current;
    const cell = CELL_BASE_PX * camera.zoom;
    const centerWorldX = (width / 2 - camera.offsetX) / cell;
    const centerWorldY = (camera.offsetY - height / 2) / cell;
    const scale = MINIMAP_SIZE / MINIMAP_SPAN;
    minimapViewRef.current = { centerWorldX, centerWorldY, scale };

    const toX = (x: number) => (x - centerWorldX) * scale + MINIMAP_SIZE / 2;
    const toY = (y: number) => MINIMAP_SIZE / 2 - (y - centerWorldY) * scale;

    const halfSpan = MINIMAP_SPAN / 2 + 1;
    const minX = Math.floor(centerWorldX - halfSpan);
    const maxX = Math.ceil(centerWorldX + halfSpan);
    const minY = Math.floor(centerWorldY - halfSpan);
    const maxY = Math.ceil(centerWorldY + halfSpan);

    const stats = statsRef.current;
    const dot = Math.max(1, scale);
    for (let y = minY; y <= maxY; y += 1) {
      const top = toY(y + 1);
      for (let x = minX; x <= maxX; x += 1) {
        const stat = stats.get(roomNameAt(x, y));
        if (!stat) {
          continue;
        }
        const key = ownerKeyOf(stat);
        if (stat.owner && key) {
          ctx.fillStyle = ownerColor(key, stat.level);
        } else if (stat.respawnArea) {
          ctx.fillStyle = COLOR_RESPAWN;
        } else if (stat.novice) {
          ctx.fillStyle = COLOR_NOVICE;
        } else {
          ctx.fillStyle = COLOR_EMPTY_ROOM;
        }
        ctx.fillRect(toX(x), top, dot, dot);
      }
    }

    // Sector guides every 10 rooms.
    ctx.strokeStyle = "rgba(122, 158, 205, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) {
      const px = Math.round(toX(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, MINIMAP_SIZE);
    }
    for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) {
      const py = Math.round(toY(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(MINIMAP_SIZE, py);
    }
    ctx.stroke();

    // Current viewport rectangle.
    const viewW = (width / cell) * scale;
    const viewH = (height / cell) * scale;
    ctx.strokeStyle = COLOR_SELECTED;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(MINIMAP_SIZE / 2 - viewW / 2, MINIMAP_SIZE / 2 - viewH / 2, viewW, viewH);
  }, []);

  drawMinimapRef.current = drawMinimap;

  /* ------------------------------------------------------------------ *
   * Camera
   * ------------------------------------------------------------------ */

  /**
   * Hides the cursor tooltip. Its position is captured when the hover starts,
   * so any camera move would otherwise leave it floating over the wrong room.
   */
  const dismissHover = useCallback(() => {
    if (hoverNameRef.current === null) {
      return;
    }
    hoverNameRef.current = null;
    setHover(null);
  }, []);

  const centerOnCoordinates = useCallback(
    (x: number, y: number, nextZoom?: number) => {
      const { width, height } = viewportSizeRef.current;
      if (width <= 0 || height <= 0) {
        return;
      }
      dismissHover();
      const camera = cameraRef.current;
      camera.zoom = clamp(nextZoom ?? camera.zoom, minZoomRef.current, MAX_ZOOM);
      const cell = CELL_BASE_PX * camera.zoom;
      camera.offsetX = width / 2 - (x + 0.5) * cell;
      camera.offsetY = height / 2 + (y + 0.5) * cell;
      setZoom(camera.zoom);
      scheduleDraw();
      scheduleLoadRef.current();
    },
    [dismissHover, scheduleDraw]
  );

  const centerOnRoom = useCallback(
    (roomName: string, nextZoom?: number) => {
      const coord = parseWorldRoomName(roomName);
      if (!coord) {
        return;
      }
      centerOnCoordinates(coord.x, coord.y, nextZoom);
    },
    [centerOnCoordinates]
  );

  const applyZoom = useCallback(
    (targetZoom: number, focusX?: number, focusY?: number) => {
      const { width, height } = viewportSizeRef.current;
      if (width <= 0 || height <= 0) {
        return;
      }
      const camera = cameraRef.current;
      const clamped = clamp(targetZoom, minZoomRef.current, MAX_ZOOM);
      if (Math.abs(clamped - camera.zoom) < 1e-6) {
        return;
      }
      dismissHover();

      const focusPointX = Number.isFinite(focusX) ? (focusX as number) : width / 2;
      const focusPointY = Number.isFinite(focusY) ? (focusY as number) : height / 2;
      const anchorX = (focusPointX - camera.offsetX) / camera.zoom;
      const anchorY = (focusPointY - camera.offsetY) / camera.zoom;

      camera.zoom = clamped;
      camera.offsetX = focusPointX - anchorX * clamped;
      camera.offsetY = focusPointY - anchorY * clamped;
      setZoom(clamped);
      scheduleDraw();
      scheduleLoadRef.current();
    },
    [dismissHover, scheduleDraw]
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      dismissHover();
      cameraRef.current.offsetX += deltaX;
      cameraRef.current.offsetY += deltaY;
      scheduleDraw();
      scheduleLoadRef.current();
    },
    [dismissHover, scheduleDraw]
  );

  const resetView = useCallback(
    (useOwnRooms = true) => {
      interactedRef.current = false;
      const ownCoords =
        useOwnRooms && ownRoomNames.length > 0
          ? ownRoomNames
              .map((room) => parseWorldRoomName(room))
              .filter((coord): coord is { x: number; y: number } => coord !== null)
          : [];
      if (ownCoords.length > 0) {
        const sum = ownCoords.reduce(
          (accumulator, coord) => ({ x: accumulator.x + coord.x, y: accumulator.y + coord.y }),
          { x: 0, y: 0 }
        );
        centerOnCoordinates(sum.x / ownCoords.length, sum.y / ownCoords.length, 1.1);
        return;
      }
      centerOnCoordinates(0, 0, 1);
    },
    [centerOnCoordinates, ownRoomNames]
  );

  resetViewRef.current = resetView;

  /* ------------------------------------------------------------------ *
   * Viewport sizing
   * ------------------------------------------------------------------ */

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const refresh = () => {
      const rect = viewport.getBoundingClientRect();
      const next = {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      };
      viewportSizeRef.current = next;
      setViewportSize(next);
      if (next.width <= 0 || next.height <= 0) {
        return;
      }
      if (!hydratedRef.current) {
        hydratedRef.current = true;
        interactedRef.current = false;
        resetViewRef.current();
        return;
      }
      scheduleDraw();
      scheduleLoadRef.current();
    };

    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(viewport);
    // ResizeObserver notifications are delivered with the rendering steps, so a
    // hidden/background document can miss a layout change entirely. Re-measure
    // whenever the document becomes visible again.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [scheduleDraw]);

  /** Keep the canvas crisp when the device pixel ratio changes (zoom, monitor swap). */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => scheduleDraw();
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [scheduleDraw]);

  /* ------------------------------------------------------------------ *
   * Data loading
   * ------------------------------------------------------------------ */

  const prioritizedRoomNames = useCallback((bounds: Bounds, cap: number): string[] => {
    const cols = bounds.maxX - bounds.minX + 1;
    const rows = bounds.maxY - bounds.minY + 1;
    const total = cols * rows;
    const out: string[] = [];

    if (total <= cap) {
      for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          out.push(roomNameAt(x, y));
        }
      }
      return out;
    }

    // Ring expansion from the viewport centre so the rooms you are actually
    // looking at arrive first.
    const camera = cameraRef.current;
    const { width, height } = viewportSizeRef.current;
    const cell = CELL_BASE_PX * camera.zoom;
    const centerX = Math.round((width / 2 - camera.offsetX) / cell - 0.5);
    const centerY = Math.round((camera.offsetY - height / 2) / cell - 0.5);
    const maxRadius = Math.max(cols, rows, 1);

    for (let radius = 0; radius <= maxRadius && out.length < cap; radius += 1) {
      for (let dy = -radius; dy <= radius && out.length < cap; dy += 1) {
        for (let dx = -radius; dx <= radius && out.length < cap; dx += 1) {
          if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
            continue;
          }
          const x = centerX + dx;
          const y = centerY + dy;
          if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
            continue;
          }
          out.push(roomNameAt(x, y));
        }
      }
    }
    return out;
  }, []);

  const loadVisibleRooms = useCallback(
    async (options?: { refresh?: boolean }) => {
      const refresh = options?.refresh ?? false;
      if (!refresh && Date.now() - lastFailureRef.current < FAILURE_BACKOFF_MS) {
        return;
      }

      const { width, height } = viewportSizeRef.current;
      if (width <= 0 || height <= 0) {
        return;
      }

      // Snapshot the generation this request belongs to. If the user switches
      // shard or server while it is in flight, the response must be dropped:
      // `resetStats` has already emptied the cache, and accepting it would mark
      // those rooms as resolved using another shard's data.
      const requestShard = shardRef.current;
      const requestBaseUrl = authBaseUrlRef.current;

      const bounds = visibleBounds(cameraRef.current, width, height);
      const candidates = prioritizedRoomNames(bounds, MAX_REQUEST_ROOMS * REQUEST_CANDIDATE_FACTOR);
      const missing = candidates
        .filter(
          (name) =>
            !pendingRef.current.has(name) &&
            (refresh || (!statsRef.current.has(name) && !resolvedRef.current.has(name)))
        )
        .slice(0, MAX_REQUEST_ROOMS);

      if (missing.length === 0) {
        return;
      }

      for (const name of missing) {
        pendingRef.current.add(name);
      }
      inflightRef.current += 1;
      setBusy(true);
      setLoadError(null);

      try {
        const result = await fetchWorldMapRooms({
          baseUrl: authContext.baseUrl,
          token: authContext.token,
          username: authContext.username,
          rooms: missing,
          // Read the shard from a ref so a load that was scheduled just before a
          // shard switch can never request the previous shard's data.
          shard: shardRef.current || undefined,
        });

        if (shardRef.current !== requestShard || authBaseUrlRef.current !== requestBaseUrl) {
          return;
        }

        for (const room of result.rooms) {
          statsRef.current.set(room.room, room);
        }
        if (result.ok) {
          for (const name of missing) {
            resolvedRef.current.add(name);
          }
          lastFailureRef.current = 0;
          setNotice(null);
        } else {
          lastFailureRef.current = Date.now();
          setNotice(t("map.noticeNoStats"));
        }
        if (result.gameTime !== undefined) {
          setGameTime(result.gameTime);
        }
        setStatsVersion((version) => version + 1);
        publishDerived();
        scheduleDraw();
      } catch (error) {
        lastFailureRef.current = Date.now();
        setLoadError(error instanceof Error ? error.message : t("common.unknownError"));
      } finally {
        for (const name of missing) {
          pendingRef.current.delete(name);
        }
        inflightRef.current = Math.max(0, inflightRef.current - 1);
        if (inflightRef.current === 0) {
          setBusy(false);
        }
      }
    },
    [authContext, prioritizedRoomNames, publishDerived, scheduleDraw, t]
  );

  const loadFn = useCallback(() => {
    void loadVisibleRooms();
  }, [loadVisibleRooms]);

  const scheduleLoad = useCallback(() => {
    if (loadTimerRef.current !== null) {
      window.clearTimeout(loadTimerRef.current);
    }
    loadTimerRef.current = window.setTimeout(() => {
      loadTimerRef.current = null;
      loadFnRef.current();
    }, FETCH_DEBOUNCE_MS);
  }, []);

  loadFnRef.current = loadFn;
  loadVisibleRef.current = loadVisibleRooms;
  scheduleLoadRef.current = scheduleLoad;

  // A shard switch reloads the same camera position against the new shard.
  useEffect(() => {
    loadFnRef.current();
  }, [shard]);

  useEffect(() => {
    loadFnRef.current();
  }, [loadFn]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadVisibleRef.current({ refresh: true });
    }, STATS_POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // A different server invalidates everything cached for the previous one.
  useEffect(() => {
    statsRef.current = new Map();
    resolvedRef.current = new Set();
    pendingRef.current = new Set();
    lastFailureRef.current = 0;
    setSelected(null);
    setHighlightOwner(null);
    setNotice(null);
    setStatsVersion((version) => version + 1);
    publishDerived();
    scheduleDraw();
  }, [authContext.baseUrl, publishDerived, scheduleDraw]);

  // Only meaningful for a signed-in account; guests simply get no highlight.
  const ownRoomsToken = session?.token?.trim() ? session.token : "";
  /**
   * Stable identity for the own-rooms request: `authContext` is rebuilt whenever
   * the settings store rehydrates, which would otherwise refetch on every render.
   */
  const ownRoomsAuth = useMemo<WorldMapAuthContext>(
    () => ({
      baseUrl: authContext.baseUrl,
      token: authContext.token,
      username: authContext.username,
    }),
    [authContext.baseUrl, authContext.token, authContext.username]
  );
  useEffect(() => {
    if (!ownRoomsToken) {
      setOwnRoomNames([]);
      return;
    }
    let cancelled = false;
    void fetchWorldMapOwnRooms(ownRoomsAuth)
      .then((rooms) => {
        if (!cancelled) {
          setOwnRoomNames(rooms);
        }
      })
      .catch(() => {
        // Own-room highlighting is a nicety; ignore failures.
      });
    return () => {
      cancelled = true;
    };
  }, [ownRoomsAuth, ownRoomsToken]);

  useEffect(() => {
    if (ownRoomNames.length === 0 || interactedRef.current) {
      return;
    }
    resetView();
  }, [ownRoomNames, resetView]);

  /* ------------------------------------------------------------------ *
   * Redraw triggers
   * ------------------------------------------------------------------ */

  useEffect(() => {
    scheduleDraw();
  }, [layers, highlightOwner, selected, ownRoomSet, scheduleDraw]);

  /* ------------------------------------------------------------------ *
   * Gestures
   * ------------------------------------------------------------------ */

  const gestures = useMapPointerGestures({
    enabled: viewportSize.width > 0,
    viewportRef,
    onPan: (deltaX, deltaY) => {
      interactedRef.current = true;
      dragDistanceRef.current += Math.hypot(deltaX, deltaY);
      panBy(deltaX, deltaY);
    },
    onPinch: (factor, focusX, focusY, panX, panY) => {
      interactedRef.current = true;
      dragDistanceRef.current += 64;
      applyZoom(cameraRef.current.zoom * factor, focusX, focusY);
      panBy(panX, panY);
    },
  });

  useMapWheelZoom({
    enabled: viewportSize.width > 0,
    viewportRef,
    onZoom: (factor, focusX, focusY) => {
      interactedRef.current = true;
      dismissHover();
      applyZoom(cameraRef.current.zoom * factor, focusX, focusY);
    },
  });

  const handleViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragDistanceRef.current = 0;
      dismissHover();
      gestures.handlePointerDown(event);
    },
    [dismissHover, gestures.handlePointerDown]
  );

  const handleViewportPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gestures.isActive) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const coord = roomAtPoint(
        cameraRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      const name = roomNameAt(coord.x, coord.y);
      if (name === hoverNameRef.current) {
        return;
      }
      hoverNameRef.current = name;
      const geometry = roomScreenOrigin(cameraRef.current, coord.x, coord.y);
      setHover({ name, left: geometry.left, top: geometry.top, size: geometry.cell });
    },
    [gestures.isActive]
  );

  const handleViewportPointerLeave = useCallback(() => {
    dismissHover();
  }, [dismissHover]);

  const openRoom = useCallback(
    (roomName: string) => {
      const params = new URLSearchParams({ name: roomName });
      if (shard) {
        params.set("shard", shard);
      }
      navigate(`/rooms?${params.toString()}`);
    },
    [navigate, shard]
  );

  const handleViewportClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A drag ends with a click event; only treat short taps as room picks.
      if (gestures.isActive || dragDistanceRef.current > 6) {
        dragDistanceRef.current = 0;
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const coord = roomAtPoint(
        cameraRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      setSelected(roomNameAt(coord.x, coord.y));
    },
    [gestures.isActive]
  );

  const handleViewportDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const coord = roomAtPoint(
        cameraRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      openRoom(roomNameAt(coord.x, coord.y));
    },
    [openRoom]
  );

  const handleViewportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const { width, height } = viewportSizeRef.current;
      const step = event.shiftKey ? 0.6 : 0.25;
      switch (event.key) {
        case "ArrowLeft":
          interactedRef.current = true;
          panBy(width * step, 0);
          break;
        case "ArrowRight":
          interactedRef.current = true;
          panBy(-width * step, 0);
          break;
        case "ArrowUp":
          interactedRef.current = true;
          panBy(0, height * step);
          break;
        case "ArrowDown":
          interactedRef.current = true;
          panBy(0, -height * step);
          break;
        case "+":
        case "=":
          interactedRef.current = true;
          applyZoom(cameraRef.current.zoom * ZOOM_STEP);
          break;
        case "-":
        case "_":
          interactedRef.current = true;
          applyZoom(cameraRef.current.zoom / ZOOM_STEP);
          break;
        case "0":
          resetView(false);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [applyZoom, panBy, resetView]
  );

  /* ------------------------------------------------------------------ *
   * Minimap interaction
   * ------------------------------------------------------------------ */

  const moveFromMinimap = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = minimapRef.current;
      const view = minimapViewRef.current;
      if (!canvas || !view) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      // The CSS box can be smaller than the drawing buffer on narrow layouts, so
      // pointer positions are mapped into minimap coordinates first.
      const scaleX = rect.width > 0 ? rect.width / MINIMAP_SIZE : 1;
      const scaleY = rect.height > 0 ? rect.height / MINIMAP_SIZE : 1;
      const worldX =
        view.centerWorldX +
        ((clientX - rect.left) / scaleX - MINIMAP_SIZE / 2) / view.scale;
      const worldY =
        view.centerWorldY -
        ((clientY - rect.top) / scaleY - MINIMAP_SIZE / 2) / view.scale;
      interactedRef.current = true;
      centerOnCoordinates(worldX - 0.5, worldY - 0.5);
    },
    [centerOnCoordinates]
  );

  const handleMinimapPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      minimapDraggingRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }
      moveFromMinimap(event.clientX, event.clientY);
    },
    [moveFromMinimap]
  );

  const handleMinimapPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!minimapDraggingRef.current) {
        return;
      }
      moveFromMinimap(event.clientX, event.clientY);
    },
    [moveFromMinimap]
  );

  const handleMinimapPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    minimapDraggingRef.current = false;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture is best-effort.
    }
  }, []);

  /* ------------------------------------------------------------------ *
   * Toolbar actions
   * ------------------------------------------------------------------ */

  const zoomIn = useCallback(() => {
    interactedRef.current = true;
    applyZoom(cameraRef.current.zoom * ZOOM_STEP);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    interactedRef.current = true;
    applyZoom(cameraRef.current.zoom / ZOOM_STEP);
  }, [applyZoom]);

  const resetStats = useCallback(() => {
    statsRef.current = new Map();
    resolvedRef.current = new Set();
    pendingRef.current = new Set();
    lastFailureRef.current = 0;
  }, []);

  const handleShardChange = useCallback(
    (nextShard: string) => {
      setShard(nextShard);
      resetStats();
      clearWorldMapRoomCache();
      setSelected(null);
      setHighlightOwner(null);
      setNotice(null);
      setLoadError(null);
      setOwnRoomNames([]);
      setStatsVersion((version) => version + 1);
      publishDerived();
      resetView(false);
    },
    [publishDerived, resetStats, resetView]
  );

  const handleJump = useCallback(() => {
    const roomName = normalizeWorldRoomName(roomInput);
    if (!roomName) {
      return;
    }
    interactedRef.current = true;
    setRoomInput(roomName);
    setSelected(roomName);
    centerOnRoom(roomName);
  }, [centerOnRoom, roomInput]);

  const handleRefresh = useCallback(() => {
    resetStats();
    clearWorldMapRoomCache();
    setNotice(null);
    void loadVisibleRooms({ refresh: true });
  }, [loadVisibleRooms, resetStats]);

  const handleSelectRoom = useCallback(
    (roomName: string, center: boolean) => {
      interactedRef.current = true;
      setSelected(roomName);
      if (center) {
        centerOnRoom(roomName);
      }
    },
    [centerOnRoom]
  );

  /* ------------------------------------------------------------------ *
   * Derived lists
   * ------------------------------------------------------------------ */

  useEffect(() => {
    if (!selected) {
      setSelectedInfo(null);
      return;
    }
    const stat = statsRef.current.get(selected) ?? null;
    setSelectedInfo({ stat, loaded: stat !== null || resolvedRef.current.has(selected) });
  }, [selected, statsVersion]);

  useEffect(() => {
    if (!hover) {
      setHoverInfo(null);
      return;
    }
    const stat = statsRef.current.get(hover.name) ?? null;
    setHoverInfo({ stat, loaded: stat !== null || resolvedRef.current.has(hover.name) });
  }, [hover, statsVersion]);

  const selectedStat = selectedInfo?.stat ?? null;
  const selectedCoord = useMemo(() => (selected ? parseWorldRoomName(selected) : null), [selected]);

  const describeRoom = useCallback(
    (name: string, stat: WorldRoomStat | null, loaded: boolean): string => {
      const coord = parseWorldRoomName(name);
      const parts: string[] = [];
      if (coord) {
        parts.push(`(${coord.x}, ${coord.y})`);
      }
      if (stat?.owner) {
        parts.push(stat.level !== undefined ? `${stat.owner} · RCL ${stat.level}` : stat.owner);
      } else if (coord && isHighwayRoom(coord)) {
        parts.push(t("map.typeHighway"));
      } else if (stat?.novice) {
        parts.push(t("map.typeNovice"));
      } else if (stat?.respawnArea) {
        parts.push(t("map.typeRespawn"));
      } else if (loaded) {
        parts.push(t("map.unowned"));
      } else {
        parts.push(t("map.unloaded"));
      }
      return parts.join(" · ");
    },
    [t]
  );

  const roomTypeLabel = useCallback(
    (coord: { x: number; y: number } | null, stat: WorldRoomStat | null): string => {
      if (stat?.respawnArea) {
        return t("map.typeRespawn");
      }
      if (stat?.novice) {
        return t("map.typeNovice");
      }
      if (coord && isHighwayRoom(coord)) {
        return t("map.typeHighway");
      }
      return t("map.typeNormal");
    },
    [t]
  );

  const selectedOwnerKey = ownerKeyOf(selectedStat ?? undefined);

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  const layerDefs: Array<{ id: keyof LayerState; label: string }> = [
    { id: "names", label: t("map.layerNames") },
    { id: "owners", label: t("map.layerOwners") },
    { id: "levels", label: t("map.layerLevels") },
    { id: "grid", label: t("map.layerGrid") },
    { id: "highways", label: t("map.layerHighways") },
    { id: "special", label: t("map.layerSpecial") },
    { id: "ownRooms", label: t("map.layerOwnRooms") },
    { id: "previews", label: t("map.layerPreviews") },
  ];

  const tooltipBelow = hover !== null && hover.top < 84;
  const tooltipLeft = hover
    ? clamp(hover.left + hover.size / 2, 96, Math.max(96, viewportSize.width - 96))
    : 0;
  const tooltipStyle: CSSProperties | undefined = hover
    ? {
        left: tooltipLeft,
        top: tooltipBelow ? hover.top + hover.size + 8 : hover.top - 8,
        transform: tooltipBelow ? "translateX(-50%)" : "translate(-50%, -100%)",
      }
    : undefined;

  return (
    <section className="panel dashboard-panel world-map-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{t("map.title")}</h1>
          <p className="page-subtitle">{t("map.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={handleRefresh}>
            {t("common.refreshNow")}
          </button>
        </div>
      </header>

      <div className="world-map-toolbar">
        <label className="field compact-field">
          <span>{t("map.shard")}</span>
          <select
            value={shard}
            onChange={(event) => handleShardChange(event.currentTarget.value)}
            disabled={shardOptions.length === 0 || shardsBusy}
          >
            <option value="">{t("map.shardDefault")}</option>
            {shardOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="field compact-field world-map-search">
          <span>{t("map.jumpLabel")}</span>
          <span className="world-map-search-row">
            <input
              value={roomInput}
              onChange={(event) => setRoomInput(event.currentTarget.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleJump();
                }
              }}
              placeholder="W8N3"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="secondary-button"
              type="button"
              onClick={handleJump}
              disabled={normalizeWorldRoomName(roomInput) === undefined}
            >
              {t("map.jump")}
            </button>
          </span>
        </label>

        <div className="world-map-zoom-controls">
          <button
            className="ghost-button"
            type="button"
            onClick={zoomOut}
            aria-label={t("map.zoomOut")}
            title={t("map.zoomOut")}
          >
            −
          </button>
          <span className="entity-chip">{Math.round(zoom * 100)}%</span>
          <button
            className="ghost-button"
            type="button"
            onClick={zoomIn}
            aria-label={t("map.zoomIn")}
            title={t("map.zoomIn")}
          >
            +
          </button>
          <button className="ghost-button" type="button" onClick={() => resetView()}>
            {t("map.reset")}
          </button>
        </div>
      </div>

      {loadError ? (
        <p className="error-text">{loadError}</p>
      ) : notice ? (
        <p className="hint-text">{notice}</p>
      ) : null}

      {ownRoomsToken ? null : <p className="hint-text">{t("map.guestHint")}</p>}

      <div className="world-map-layout">
        <div className="world-map-stage">
          <div className="world-map-hud">
            <span className="entity-chip">
              {t("map.center")}: {centerRoom}
            </span>
            <span className="entity-chip">
              {t("map.loadedRooms")}: {loadedRooms}
              {visibleRooms > 0 ? ` / ${visibleRooms}` : ""}
            </span>
            <span className="entity-chip">
              {t("map.ownedRooms")}: {ownedRooms}
            </span>
            {gameTime !== null ? (
              <span className="entity-chip">
                {t("map.gameTime")}: {gameTime.toLocaleString()}
              </span>
            ) : null}
            {busy ? (
              <span className="entity-chip world-map-busy">{t("common.syncing")}</span>
            ) : null}
          </div>

          <div
            ref={viewportRef}
            className={`world-map-viewport${gestures.isActive ? " is-dragging" : ""}`}
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={gestures.handlePointerUp}
            onPointerCancel={gestures.handlePointerCancel}
            onPointerLeave={handleViewportPointerLeave}
            onClick={handleViewportClick}
            onDoubleClick={handleViewportDoubleClick}
            onKeyDown={handleViewportKeyDown}
            role="application"
            tabIndex={0}
            aria-label={t("map.canvasLabel")}
          >
            <canvas ref={canvasRef} className="world-map-canvas" />

            {hover && tooltipStyle ? (
              <>
                <span
                  className="world-map-hover-ring"
                  style={{
                    left: hover.left,
                    top: hover.top,
                    width: hover.size,
                    height: hover.size,
                  }}
                />
                <div className="world-map-tooltip" style={tooltipStyle}>
                  <strong>{hover.name}</strong>
                  <span className="world-map-tooltip-meta">
                    {describeRoom(hover.name, hoverInfo?.stat ?? null, hoverInfo?.loaded ?? false)}
                  </span>
                  <span className="world-map-tooltip-hint">{t("map.tooltipHint")}</span>
                </div>
              </>
            ) : null}

            <canvas
              ref={minimapRef}
              className="world-map-minimap"
              onPointerDown={handleMinimapPointerDown}
              onPointerMove={handleMinimapPointerMove}
              onPointerUp={handleMinimapPointerUp}
              onPointerCancel={handleMinimapPointerUp}
              aria-label={t("map.minimapLabel")}
            />
          </div>

          <div className="world-map-legend">
            <span className="world-map-legend-item">
              <i className="world-map-swatch" style={{ background: "#4b8ad6" }} />
              {t("map.legendClaimed")}
            </span>
            <span className="world-map-legend-item">
              <i className="world-map-swatch" style={{ background: COLOR_EMPTY_ROOM }} />
              {t("map.legendUnowned")}
            </span>
            <span className="world-map-legend-item">
              <i className="world-map-swatch" style={{ background: COLOR_UNKNOWN_ROOM }} />
              {t("map.legendUnknown")}
            </span>
            <span className="world-map-legend-item">
              <i className="world-map-swatch" style={{ background: COLOR_HIGHWAY_ROOM }} />
              {t("map.legendHighway")}
            </span>
            {layers.special ? (
              <>
                <span className="world-map-legend-item">
                  <i className="world-map-swatch" style={{ background: COLOR_NOVICE }} />
                  {t("map.legendNovice")}
                </span>
                <span className="world-map-legend-item">
                  <i className="world-map-swatch" style={{ background: COLOR_RESPAWN }} />
                  {t("map.legendRespawn")}
                </span>
              </>
            ) : null}
            <span className="world-map-legend-item">
              <i className="world-map-swatch" style={{ background: COLOR_MINE }} />
              {t("map.legendMine")}
            </span>
          </div>
        </div>

        <aside className="world-map-inspector">
          {selected ? (
            <article className="world-map-inspector-card">
              <header className="world-map-inspector-head">
                <div>
                  <h3>{selected}</h3>
                  <p className="hint-text">
                    {selectedCoord ? `(${selectedCoord.x}, ${selectedCoord.y})` : ""}
                  </p>
                </div>
                <span className="world-map-type-badge">
                  {roomTypeLabel(selectedCoord, selectedStat)}
                </span>
              </header>

              <dl className="world-map-facts">
                <div>
                  <dt>{t("map.owner")}</dt>
                  <dd>{selectedStat?.owner ?? t("map.unowned")}</dd>
                </div>
                <div>
                  <dt>{t("map.level")}</dt>
                  <dd>{selectedStat?.level ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("map.safeMode")}</dt>
                  <dd>{selectedStat?.safeMode ? t("map.yes") : t("map.no")}</dd>
                </div>
                <div>
                  <dt>{t("map.status")}</dt>
                  <dd>{selectedInfo?.loaded ? t("map.loaded") : t("map.unloaded")}</dd>
                </div>
              </dl>

              <div className="world-map-inspector-actions">
                <button className="secondary-button" type="button" onClick={() => openRoom(selected)}>
                  {t("map.openRoom")}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => handleSelectRoom(selected, true)}
                >
                  {t("map.centerOnRoom")}
                </button>
                {selectedOwnerKey ? (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() =>
                      setHighlightOwner((current) =>
                        current === selectedOwnerKey ? null : selectedOwnerKey
                      )
                    }
                  >
                    {highlightOwner === selectedOwnerKey
                      ? t("map.clearHighlight")
                      : t("map.highlightOwner")}
                  </button>
                ) : null}
              </div>
            </article>
          ) : (
            <article className="world-map-inspector-card">
              <h3>{t("map.noSelection")}</h3>
              <p className="hint-text">{t("map.noSelectionHint")}</p>
            </article>
          )}

          <section className="world-map-inspector-section">
            <h4>{t("map.layers")}</h4>
            <div className="world-map-layers">
              {layerDefs.map((layer) => (
                <label key={layer.id} className="world-map-layer">
                  <input
                    type="checkbox"
                    checked={layers[layer.id]}
                    onChange={(event) => {
                      // `currentTarget` is nulled once the handler returns, so the
                      // value has to be captured before the state updater runs.
                      const { checked } = event.currentTarget;
                      setLayers((current) => ({ ...current, [layer.id]: checked }));
                    }}
                  />
                  <span>{layer.label}</span>
                </label>
              ))}
            </div>
            {layers.previews ? (
              <p className="hint-text">
                {previewStatus === "unavailable"
                  ? t("map.previewsUnavailable")
                  : previewCount > 0
                    ? t("map.previewsReady", { count: previewCount })
                    : t("map.previewsPending")}
              </p>
            ) : null}
          </section>

          <section className="world-map-inspector-section">
            <h4>
              {t("map.players")} <span className="world-map-count">{players.length}</span>
            </h4>
            {players.length === 0 ? (
              <p className="hint-text">{t("map.playersEmpty")}</p>
            ) : (
              <ul className="world-map-list">
                {players.slice(0, 40).map((player) => (
                  <li key={player.key}>
                    <button
                      type="button"
                      className={`world-map-list-item${
                        highlightOwner === player.key ? " is-active" : ""
                      }`}
                      onClick={() =>
                        setHighlightOwner((current) => (current === player.key ? null : player.key))
                      }
                    >
                      <i
                        className="world-map-swatch"
                        style={{ background: ownerColor(player.key, player.maxLevel) }}
                      />
                      <span className="world-map-list-name">{player.name}</span>
                      <span className="world-map-list-meta">
                        {player.rooms}
                        {player.maxLevel !== undefined ? ` · RCL ${player.maxLevel}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="world-map-inspector-section">
            <h4>
              {t("map.myRooms")} <span className="world-map-count">{ownRoomNames.length}</span>
            </h4>
            {ownRoomNames.length === 0 ? (
              <p className="hint-text">
                {ownRoomsToken ? t("map.myRoomsEmpty") : t("map.myRoomsGuest")}
              </p>
            ) : (
              <ul className="world-map-list world-map-list-inline">
                {ownRoomNames.map((room) => (
                  <li key={room}>
                    <button
                      type="button"
                      className={`world-map-room-chip${selected === room ? " is-active" : ""}`}
                      onClick={() => handleSelectRoom(room, true)}
                    >
                      {room}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="hint-text world-map-total">
            {t("map.totalLoaded")}: {totalLoaded}
          </p>
        </aside>
      </div>

      <p className="hint-text">{t("map.hint")}</p>
    </section>
  );
}
