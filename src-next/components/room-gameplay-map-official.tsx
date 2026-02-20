"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { SCREEPS_RENDERER_RESOURCE_MAP } from "../lib/screeps/renderer-resource-map";
import type { RoomObjectSummary } from "../lib/screeps/types";
import { useSettingsStore } from "../stores/settings-store";

interface RoomGameplayMapProps {
  encoded?: string;
  roomName: string;
  roomShard?: string;
  gameTime?: number;
  roomObjects?: RoomObjectSummary[];
}

interface RendererObjectState {
  _id: string;
  room: string;
  type: string;
  x: number;
  y: number;
  user?: string;
  name?: string;
  hits?: number;
  hitsMax?: number;
  ageTime?: number;
  ticksToLive?: number;
}

interface RendererUserState {
  username: string;
  color: number;
}

interface RendererMetadata {
  objects?: Record<string, unknown>;
}

interface RendererInstance {
  init(container: HTMLElement): Promise<void>;
  release(): void;
  resize(size?: { width: number; height: number }): void;
  applyState(
    state: { objects: RendererObjectState[]; users?: Record<string, RendererUserState>; gameTime?: number },
    tickDuration?: number
  ): void;
  setTerrain(terrain: RendererObjectState[]): void;
  zoomLevel: number;
  zoomTo(value: number, x: number, y: number): void;
  pan(x: number, y: number): void;
}

interface RendererInternals {
  app?: { stage?: { position?: { x: number; y: number } } };
  world?: { options?: { VIEW_BOX?: number } };
}

interface RendererModule {
  GameRenderer?: new (options: Record<string, unknown>) => RendererInstance;
  PIXI?: unknown;
  default?: new (options: Record<string, unknown>) => RendererInstance;
}

interface PixiTextureLike {
  _uvs?: unknown;
  updateUvs?: () => void;
}

interface PixiAssetsLike {
  Assets?: {
    get?: (alias: string) => unknown;
  };
}

interface PixiSpriteLike {
  _texture?: PixiTextureLike | null;
  uvs?: unknown;
}

interface PixiAnimatedSpriteLike {
  _texture?: PixiTextureLike | null;
  _textures?: Array<PixiTextureLike | null | undefined>;
  _previousFrame?: number | null;
  currentFrame?: number;
  _textureID?: number;
  _textureTrimmedID?: number;
  _cachedTint?: number;
  uvs?: unknown;
  updateAnchor?: boolean;
  _anchor?: { copyFrom?: (value: unknown) => void };
  onFrameChange?: (value: number) => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
}

type OfficialRendererState = "idle" | "initializing" | "running" | "degraded" | "destroyed";
type OfficialRenderProfile = "full" | "safe";
type RendererFailurePhase = "init" | "resource" | "frame" | "filter" | "dispose";

interface RendererConsoleMonitorStore {
  original: typeof console.error;
  listeners: Set<(args: unknown[]) => void>;
}

const GRID_SIZE = 50;
const ROOM_VIEW_BOX = GRID_SIZE * 100;
const ROOM_CELL_SIZE = ROOM_VIEW_BOX / GRID_SIZE;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3.8;
const ZOOM_STEP = 1.15;
const DEFAULT_ZOOM = 1;
const MIN_RENDERER_INIT_SIZE = 16;
const RENDERER_INIT_TIMEOUT_MS = 6_000;
const WATCHDOG_LONG_FRAME_MS = 1_200;
const WATCHDOG_MAX_CONSECUTIVE_LONG_FRAMES = 2;
const MAX_RECOVERABLE_FRAME_ERRORS = 2;
const CONSOLE_MONITOR_KEY = "__screepsOfficialConsoleMonitor";
const RENDERER_SOURCE_PATTERNS = [
  "@screeps/renderer",
  "pixi",
  "webgl",
  "glsl",
  "shader",
  "filtersystem",
  "shadersystem",
  "blurfilter",
  "framebuffer",
] as const;
const RENDERER_FATAL_PATTERNS = [
  "shader",
  "program",
  "compile",
  "link",
  "webgl",
  "context lost",
  "uv",
  "filter",
  "out of memory",
  "framebuffer",
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getFitZoom(viewport: ViewportSize, viewBox: number): number {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return DEFAULT_ZOOM;
  }

  if (!Number.isFinite(viewBox) || viewBox <= 0) {
    return DEFAULT_ZOOM;
  }

  const fitByWidth = viewport.width / viewBox;
  const fitByHeight = viewport.height / viewBox;
  const preferred = Math.min(fitByWidth, fitByHeight * 1.35);
  const fit = preferred * 0.99;
  return clamp(fit, MIN_ZOOM, MAX_ZOOM);
}

function resolveRendererViewBox(renderer: RendererInstance | null): number {
  const candidate = (renderer as RendererInternals | null)?.world?.options?.VIEW_BOX;
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }
  return ROOM_VIEW_BOX;
}

function toGridCoordinate(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  if (!Number.isInteger(rounded)) {
    return null;
  }
  if (Math.abs(value - rounded) > 1e-6) {
    return null;
  }
  if (rounded < 0 || rounded >= GRID_SIZE) {
    return null;
  }
  return rounded;
}

function normalizeObjectType(type: string): string {
  if (type === "wall") {
    return "constructedWall";
  }
  return type;
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

function decodeTerrainToObjects(encoded: string | undefined, roomName: string): RendererObjectState[] {
  if (!encoded) {
    return [];
  }

  const trimmed = encoded.trim();
  if (trimmed.length !== GRID_SIZE * GRID_SIZE) {
    return [];
  }

  const terrainObjects: RendererObjectState[] = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const value = Number(trimmed[y * GRID_SIZE + x]);
      if (!Number.isFinite(value)) {
        continue;
      }

      if ((value & 1) === 1) {
        terrainObjects.push({
          _id: `${roomName}:terrain:wall:${x}:${y}`,
          room: roomName,
          type: "wall",
          x,
          y,
        });
      }

      if ((value & 2) === 2) {
        terrainObjects.push({
          _id: `${roomName}:terrain:swamp:${x}:${y}`,
          room: roomName,
          type: "swamp",
          x,
          y,
        });
      }
    }
  }

  return terrainObjects;
}

function buildRendererObjects(
  roomName: string,
  roomObjects: RoomObjectSummary[] | undefined,
  gameTime: number
): RendererObjectState[] {
  if (!roomObjects?.length) {
    return [];
  }

  const rendererObjects: RendererObjectState[] = [];
  for (const item of roomObjects) {
    const x = toGridCoordinate(item.x);
    const y = toGridCoordinate(item.y);
    if (x === null || y === null) {
      continue;
    }

    const objectState: RendererObjectState = {
      _id: item.id,
      room: roomName,
      type: normalizeObjectType(item.type),
      x,
      y,
    };

    if (item.owner) {
      objectState.user = item.owner;
    }
    if (item.name) {
      objectState.name = item.name;
    }
    if (item.hits !== undefined) {
      objectState.hits = item.hits;
    }
    if (item.hitsMax !== undefined) {
      objectState.hitsMax = item.hitsMax;
    }
    if (item.ttl !== undefined) {
      objectState.ticksToLive = item.ttl;
      objectState.ageTime = gameTime + item.ttl;
    }

    rendererObjects.push(objectState);
  }

  return rendererObjects;
}

function buildRendererUsers(roomObjects: RoomObjectSummary[] | undefined): Record<string, RendererUserState> {
  const users: Record<string, RendererUserState> = {};

  for (const object of roomObjects ?? []) {
    const owner = object.owner?.trim();
    if (!owner || users[owner]) {
      continue;
    }

    users[owner] = {
      username: owner,
      color: hashColor(owner),
    };
  }

  return users;
}

function getModuleGameRenderer(module: RendererModule): (new (options: Record<string, unknown>) => RendererInstance) | null {
  if (module.GameRenderer) {
    return module.GameRenderer;
  }
  if (module.default) {
    return module.default;
  }
  return null;
}

function ensureTextureUvs(texture: PixiTextureLike | null | undefined): boolean {
  if (!texture) {
    return false;
  }

  if (texture._uvs) {
    return true;
  }

  try {
    texture.updateUvs?.();
  } catch {
    return false;
  }

  return Boolean(texture._uvs);
}

function installPixiUvsGuards(pixiUnknown: unknown) {
  const pixi = pixiUnknown as
    | {
        Sprite?: { prototype?: Record<string, unknown> };
        AnimatedSprite?: { prototype?: Record<string, unknown> };
      }
    | undefined;
  if (!pixi) {
    return;
  }

  const spriteProto = pixi.Sprite?.prototype as
    | (Record<string, unknown> & { __screepsUvsGuardInstalled?: boolean })
    | undefined;
  if (spriteProto && !spriteProto.__screepsUvsGuardInstalled) {
    const original = spriteProto.calculateVertices as
      | ((this: PixiSpriteLike, ...args: unknown[]) => unknown)
      | undefined;
    if (typeof original === "function") {
      spriteProto.calculateVertices = function patchedCalculateVertices(
        this: PixiSpriteLike,
        ...args: unknown[]
      ) {
        const texture = this._texture ?? null;
        if (!ensureTextureUvs(texture)) {
          return;
        }
        return original.apply(this, args);
      };
      spriteProto.__screepsUvsGuardInstalled = true;
    }
  }

  const animatedSpriteProto = pixi.AnimatedSprite?.prototype as
    | (Record<string, unknown> & { __screepsUvsGuardInstalled?: boolean })
    | undefined;
  if (animatedSpriteProto && !animatedSpriteProto.__screepsUvsGuardInstalled) {
    const original = animatedSpriteProto.updateTexture as
      | ((this: PixiAnimatedSpriteLike, ...args: unknown[]) => unknown)
      | undefined;
    if (typeof original === "function") {
      animatedSpriteProto.updateTexture = function patchedUpdateTexture(
        this: PixiAnimatedSpriteLike,
        ...args: unknown[]
      ) {
        const index = this.currentFrame ?? 0;
        const texture = this._textures?.[index] ?? this._texture ?? null;
        if (!ensureTextureUvs(texture)) {
          return;
        }
        return original.apply(this, args);
      };
      animatedSpriteProto.__screepsUvsGuardInstalled = true;
    }
  }
}

function hasPixiAssetAlias(pixiUnknown: unknown, alias: string): boolean {
  const pixi = pixiUnknown as PixiAssetsLike | undefined;
  const getter = pixi?.Assets?.get;
  if (typeof getter !== "function") {
    return true;
  }

  try {
    return Boolean(getter(alias));
  } catch {
    return false;
  }
}

function filterSupportedObjects(
  objects: RendererObjectState[],
  supportedTypes: ReadonlySet<string>
): RendererObjectState[] {
  if (supportedTypes.size === 0) {
    return objects;
  }
  return objects.filter((object) => supportedTypes.has(object.type));
}

function filterUsersByObjects(
  users: Record<string, RendererUserState>,
  objects: RendererObjectState[]
): Record<string, RendererUserState> {
  const filteredUsers: Record<string, RendererUserState> = {};
  for (const object of objects) {
    const owner = object.user;
    if (!owner || filteredUsers[owner] || !users[owner]) {
      continue;
    }
    filteredUsers[owner] = users[owner];
  }
  return filteredUsers;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function matchesAnyPattern(value: string, patterns: readonly string[]): boolean {
  if (!value) {
    return false;
  }
  const lowerCase = value.toLowerCase();
  return patterns.some((pattern) => lowerCase.includes(pattern));
}

function isLikelyRendererSource(value: string): boolean {
  return matchesAnyPattern(value, RENDERER_SOURCE_PATTERNS);
}

function isLikelyRendererFatalMessage(value: string): boolean {
  return matchesAnyPattern(value, RENDERER_FATAL_PATTERNS);
}

function stringifyConsoleErrorArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return [arg.message, arg.stack].filter(Boolean).join("\n");
      }
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ")
    .trim();
}

function shouldTreatConsoleErrorAsRendererFatal(args: unknown[]): boolean {
  const joined = stringifyConsoleErrorArgs(args);
  if (!joined) {
    return false;
  }
  return isLikelyRendererSource(joined) && isLikelyRendererFatalMessage(joined);
}

function getConsoleMonitorStore(): RendererConsoleMonitorStore {
  const root = globalThis as Record<string, unknown>;
  const existing = root[CONSOLE_MONITOR_KEY] as RendererConsoleMonitorStore | undefined;
  if (existing) {
    return existing;
  }

  const original = console.error.bind(console);
  const listeners = new Set<(args: unknown[]) => void>();
  console.error = (...args: unknown[]) => {
    original(...args);
    for (const listener of Array.from(listeners)) {
      try {
        listener(args);
      } catch {
        // Keep console behaviour stable even if a listener fails.
      }
    }
  };

  const store: RendererConsoleMonitorStore = { original, listeners };
  root[CONSOLE_MONITOR_KEY] = store;
  return store;
}

function registerConsoleErrorListener(listener: (args: unknown[]) => void): () => void {
  const store = getConsoleMonitorStore();
  store.listeners.add(listener);

  return () => {
    const root = globalThis as Record<string, unknown>;
    const active = root[CONSOLE_MONITOR_KEY] as RendererConsoleMonitorStore | undefined;
    if (!active) {
      return;
    }

    active.listeners.delete(listener);
    if (active.listeners.size === 0) {
      console.error = active.original;
      delete root[CONSOLE_MONITOR_KEY];
    }
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let completed = false;
    const timeoutId = window.setTimeout(() => {
      if (completed) {
        return;
      }
      completed = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (completed) {
          return;
        }
        completed = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (completed) {
          return;
        }
        completed = true;
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export function RoomGameplayMap({
  encoded,
  roomName,
  roomShard,
  gameTime: externalGameTime,
  roomObjects,
}: RoomGameplayMapProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<RendererInstance | null>(null);
  const setupQueueRef = useRef<Promise<void>>(Promise.resolve());
  const setupAttemptRef = useRef(0);
  const releasedRenderersRef = useRef<WeakSet<object>>(new WeakSet<object>());
  const rendererStateRef = useRef<OfficialRendererState>("idle");
  const supportedObjectTypesRef = useRef<Set<string>>(new Set<string>());
  const dragRef = useRef<DragState | null>(null);
  const interactedRef = useRef(false);
  const terrainKeyRef = useRef<string>("");
  const unmountedRef = useRef(false);
  const renderProfileRef = useRef<OfficialRenderProfile>("full");
  const runtimeRef = useRef({
    watchdogFrameId: 0,
    lastWatchdogAt: 0,
    consecutiveLongFrames: 0,
    consecutiveFrameErrors: 0,
  });

  const [rendererState, setRendererState] = useState<OfficialRendererState>("idle");
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [renderProfile, setRenderProfile] = useState<OfficialRenderProfile>("full");
  const setMapRendererMode = useSettingsStore((state) => state.setMapRendererMode);

  const isReady = rendererState === "running";
  const isTerminalFailure = rendererState === "degraded" || rendererState === "destroyed";

  const viewportReady =
    viewportSize.width >= MIN_RENDERER_INIT_SIZE &&
    viewportSize.height >= MIN_RENDERER_INIT_SIZE;
  const gameTime = useMemo(
    () =>
      typeof externalGameTime === "number" && Number.isFinite(externalGameTime)
        ? Math.floor(externalGameTime)
        : Math.floor(Date.now() / 1000),
    [externalGameTime, roomObjects, roomName, roomShard]
  );
  const terrainObjects = useMemo(() => decodeTerrainToObjects(encoded, roomName), [encoded, roomName]);
  const rendererObjects = useMemo(
    () => buildRendererObjects(roomName, roomObjects, gameTime),
    [roomName, roomObjects, gameTime]
  );
  const rendererUsers = useMemo(() => buildRendererUsers(roomObjects), [roomObjects]);
  const terrainKey = useMemo(() => `${roomName}:${encoded ?? ""}`, [roomName, encoded]);

  const setOfficialState = useCallback((nextState: OfficialRendererState) => {
    rendererStateRef.current = nextState;
    setRendererState(nextState);
  }, []);

  const stopWatchdog = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.watchdogFrameId !== 0) {
      cancelAnimationFrame(runtime.watchdogFrameId);
      runtime.watchdogFrameId = 0;
    }
    runtime.lastWatchdogAt = 0;
    runtime.consecutiveLongFrames = 0;
  }, []);

  const updateZoomState = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || rendererStateRef.current !== "running") {
      return;
    }
    const nextZoom = renderer.zoomLevel;
    if (Number.isFinite(nextZoom)) {
      setZoom(nextZoom);
    }
  }, []);

  const centerView = useCallback(
    (targetZoom: number) => {
      const renderer = rendererRef.current as (RendererInstance & RendererInternals) | null;
      if (!renderer || !viewportRef.current || rendererStateRef.current !== "running") {
        return;
      }

      try {
        renderer.zoomLevel = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
        const viewBox = resolveRendererViewBox(renderer);
        const stagePosition = renderer.app?.stage?.position;
        if (stagePosition) {
          stagePosition.x = (viewportSize.width - viewBox * renderer.zoomLevel) / 2;
          stagePosition.y = (viewportSize.height - viewBox * renderer.zoomLevel) / 2;
        }
        updateZoomState();
      } catch (error) {
        setLoadError(toErrorMessage(error, "Failed to center official map renderer."));
      }
    },
    [updateZoomState, viewportSize.height, viewportSize.width]
  );

  const getFitZoomForRenderer = useCallback(
    (renderer: RendererInstance | null): number =>
      getFitZoom(viewportSize, resolveRendererViewBox(renderer)),
    [viewportSize]
  );

  const applyZoom = useCallback(
    (targetZoom: number, anchorX?: number, anchorY?: number) => {
      const renderer = rendererRef.current;
      if (!renderer || !viewportRef.current || rendererStateRef.current !== "running") {
        return;
      }

      const viewportRect = viewportRef.current.getBoundingClientRect();
      const focusX = anchorX ?? viewportRect.width / 2;
      const focusY = anchorY ?? viewportRect.height / 2;
      try {
        renderer.zoomTo(clamp(targetZoom, MIN_ZOOM, MAX_ZOOM), focusX, focusY);
        updateZoomState();
      } catch (error) {
        setLoadError(toErrorMessage(error, "Failed to zoom official map renderer."));
      }
    },
    [updateZoomState]
  );

  const releaseRendererSafely = useCallback((renderer: RendererInstance | null) => {
    if (!renderer) {
      return;
    }

    const rendererObject = renderer as unknown as object;
    if (releasedRenderersRef.current.has(rendererObject)) {
      return;
    }

    releasedRenderersRef.current.add(rendererObject);
    try {
      renderer.release();
    } catch {
      // Ignore release failures; this is a best-effort cleanup path.
    }
  }, []);

  const cleanupRendererRuntime = useCallback(
    (phase: RendererFailurePhase) => {
      stopWatchdog();
      const runtime = runtimeRef.current;
      runtime.consecutiveFrameErrors = 0;

      const mountedRenderer = rendererRef.current;
      rendererRef.current = null;
      releaseRendererSafely(mountedRenderer);

      supportedObjectTypesRef.current = new Set<string>();
      terrainKeyRef.current = "";
      dragRef.current = null;
      setIsDragging(false);
      if (phase === "dispose") {
        interactedRef.current = false;
      }

      const host = rendererHostRef.current;
      if (host) {
        host.textContent = "";
      }
    },
    [releaseRendererSafely, stopWatchdog]
  );

  const promoteToSafeProfile = useCallback(
    (phase: Exclude<RendererFailurePhase, "dispose">, message: string): boolean => {
      if (unmountedRef.current || renderProfileRef.current !== "full") {
        return false;
      }

      renderProfileRef.current = "safe";
      setRenderProfile("safe");
      setupAttemptRef.current += 1;
      cleanupRendererRuntime(phase);
      setOfficialState("idle");
      setLoadError(
        [
          "Detected renderer shader/filter instability. Switched to official safe mode and retrying.",
          message,
        ]
          .filter(Boolean)
          .join("\n")
      );
      setRetryNonce((current) => current + 1);
      return true;
    },
    [cleanupRendererRuntime, setOfficialState]
  );

  const hardKillRenderer = useCallback(
    (
      message: string,
      phase: RendererFailurePhase,
      nextState: Extract<OfficialRendererState, "degraded" | "destroyed">
    ) => {
      if (unmountedRef.current) {
        return;
      }

      if (
        phase !== "dispose" &&
        promoteToSafeProfile(phase, message)
      ) {
        return;
      }

      if (rendererStateRef.current === "degraded" || rendererStateRef.current === "destroyed") {
        setLoadError((previous) => previous ?? message);
        return;
      }

      setupAttemptRef.current += 1;
      cleanupRendererRuntime(phase);
      setOfficialState(nextState);
      setLoadError(message);
    },
    [cleanupRendererRuntime, promoteToSafeProfile, setOfficialState]
  );

  const reportRendererFailure = useCallback(
    (error: unknown, phase: RendererFailurePhase, fatal: boolean) => {
      const message = toErrorMessage(error, "Official map renderer failed.");
      const shouldHardKill = fatal || isLikelyRendererFatalMessage(message);
      if (shouldHardKill) {
        const nextState = phase === "init" || phase === "resource" ? "degraded" : "destroyed";
        hardKillRenderer(message, phase, nextState);
        return;
      }

      setLoadError(message);
    },
    [hardKillRenderer]
  );

  const runRendererAction = useCallback(
    (
      phase: RendererFailurePhase,
      action: (renderer: RendererInstance) => void,
      options?: {
        fatal?: boolean;
        fallbackMessage?: string;
        nextState?: Extract<OfficialRendererState, "degraded" | "destroyed">;
      }
    ): boolean => {
      const renderer = rendererRef.current;
      if (!renderer || rendererStateRef.current !== "running") {
        return false;
      }

      try {
        action(renderer);
        if (phase === "frame") {
          runtimeRef.current.consecutiveFrameErrors = 0;
        }
        return true;
      } catch (error) {
        const runtime = runtimeRef.current;
        if (phase === "frame") {
          runtime.consecutiveFrameErrors += 1;
        }

        const message = toErrorMessage(error, options?.fallbackMessage ?? "Official renderer action failed.");
        const shouldHardKill =
          options?.fatal === true ||
          isLikelyRendererFatalMessage(message) ||
          (phase === "frame" && runtime.consecutiveFrameErrors >= MAX_RECOVERABLE_FRAME_ERRORS);
        if (shouldHardKill) {
          hardKillRenderer(message, phase, options?.nextState ?? "destroyed");
        } else {
          setLoadError(message);
        }
        return false;
      }
    },
    [hardKillRenderer]
  );

  const startWatchdog = useCallback(() => {
    stopWatchdog();
    const runtime = runtimeRef.current;
    runtime.lastWatchdogAt = performance.now();
    runtime.consecutiveLongFrames = 0;

    const tick = (now: number) => {
      if (unmountedRef.current) {
        runtime.watchdogFrameId = 0;
        return;
      }
      if (rendererStateRef.current !== "running" || !rendererRef.current) {
        runtime.watchdogFrameId = 0;
        return;
      }

      const elapsed = now - runtime.lastWatchdogAt;
      runtime.lastWatchdogAt = now;
      if (elapsed > WATCHDOG_LONG_FRAME_MS) {
        runtime.consecutiveLongFrames += 1;
        if (runtime.consecutiveLongFrames >= WATCHDOG_MAX_CONSECUTIVE_LONG_FRAMES) {
          hardKillRenderer(
            `Official renderer stopped after repeated long frames (> ${WATCHDOG_LONG_FRAME_MS}ms).`,
            "frame",
            "destroyed"
          );
          return;
        }
      } else {
        runtime.consecutiveLongFrames = 0;
      }

      runtime.watchdogFrameId = requestAnimationFrame(tick);
    };

    runtime.watchdogFrameId = requestAnimationFrame(tick);
  }, [hardKillRenderer, stopWatchdog]);

  const retryOfficialRenderer = useCallback(() => {
    if (rendererStateRef.current === "initializing") {
      return;
    }

    renderProfileRef.current = "full";
    setRenderProfile("full");
    setupAttemptRef.current += 1;
    cleanupRendererRuntime("dispose");
    setLoadError(null);
    setZoom(DEFAULT_ZOOM);
    setOfficialState("idle");
    setRetryNonce((current) => current + 1);
  }, [cleanupRendererRuntime, setOfficialState]);

  const switchToOptimizedRenderer = useCallback(() => {
    setMapRendererMode("optimized");
  }, [setMapRendererMode]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      setupAttemptRef.current += 1;
      rendererStateRef.current = "destroyed";
      cleanupRendererRuntime("dispose");
    };
  }, [cleanupRendererRuntime]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const refreshViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    refreshViewportSize();
    const observer = new ResizeObserver(refreshViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!viewportReady || rendererRef.current || rendererStateRef.current !== "idle") {
      return;
    }

    let cancelled = false;
    const setupId = setupAttemptRef.current + 1;
    setupAttemptRef.current = setupId;

    const setupRenderer = async () => {
      if (
        cancelled ||
        setupId !== setupAttemptRef.current ||
        rendererRef.current ||
        rendererStateRef.current !== "idle"
      ) {
        return;
      }

      const host = rendererHostRef.current;
      if (!host) {
        return;
      }

      setOfficialState("initializing");
      setLoadError(null);
      let shouldFinalizeState = true;

      try {
        const rendererModule = (await withTimeout(
          import("@screeps/renderer") as Promise<RendererModule>,
          RENDERER_INIT_TIMEOUT_MS,
          "Official renderer module load timed out."
        )) as RendererModule;
        const globalRecord = globalThis as Record<string, unknown>;
        const windowRecord =
          typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : undefined;
        if (rendererModule.PIXI) {
          installPixiUvsGuards(rendererModule.PIXI);
          globalRecord.PIXI = rendererModule.PIXI;
          if (windowRecord) {
            windowRecord.PIXI = rendererModule.PIXI;
          }
        }

        await withTimeout(
          import("@screeps/renderer-metadata"),
          RENDERER_INIT_TIMEOUT_MS,
          "Official renderer metadata load timed out."
        );
        const rendererMetadata = (globalRecord.RENDERER_METADATA ?? windowRecord?.RENDERER_METADATA) as
          | RendererMetadata
          | undefined;
        const metadataObjects =
          rendererMetadata?.objects && typeof rendererMetadata.objects === "object"
            ? rendererMetadata.objects
            : undefined;

        const GameRenderer = getModuleGameRenderer(rendererModule);
        if (!GameRenderer || !rendererMetadata || !metadataObjects || Object.keys(metadataObjects).length === 0) {
          throw new Error("Official Screeps renderer is unavailable.");
        }
        supportedObjectTypesRef.current = new Set(Object.keys(metadataObjects));

        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (cancelled || setupId !== setupAttemptRef.current || rendererRef.current) {
            return;
          }

          host.textContent = "";
          const renderer = new GameRenderer({
            autoFocus: false,
            autoStart: true,
            useDefaultLogger: false,
            size: {
              width: viewportSize.width,
              height: viewportSize.height,
            },
            resourceMap: SCREEPS_RENDERER_RESOURCE_MAP,
            worldConfigs: {
              metadata: rendererMetadata,
              ROOM_SIZE: GRID_SIZE,
              CELL_SIZE: ROOM_CELL_SIZE,
              HALF_CELL_SIZE: ROOM_CELL_SIZE / 2,
              VIEW_BOX: ROOM_VIEW_BOX,
              RENDER_SIZE: {
                width: ROOM_VIEW_BOX,
                height: ROOM_VIEW_BOX,
              },
              lighting: renderProfileRef.current === "safe" ? "disabled" : "normal",
            },
          });

          await withTimeout(
            renderer.init(host),
            RENDERER_INIT_TIMEOUT_MS,
            "Official renderer initialization timed out."
          );
          if (cancelled || setupId !== setupAttemptRef.current) {
            releaseRendererSafely(renderer);
            host.textContent = "";
            return;
          }

          if (!hasPixiAssetAlias(rendererModule.PIXI, "glow")) {
            releaseRendererSafely(renderer);
            host.textContent = "";
            if (attempt === 0) {
              continue;
            }
            throw new Error("Official renderer resources failed to initialize.");
          }

          rendererRef.current = renderer;
          setOfficialState("running");
          setLoadError(null);
          setZoom(renderer.zoomLevel);
          startWatchdog();
          return;
        }
      } catch (error) {
        if (cancelled || setupId !== setupAttemptRef.current) {
          return;
        }
        shouldFinalizeState = false;
        reportRendererFailure(error, "init", true);
      } finally {
        if (!cancelled && setupId === setupAttemptRef.current && shouldFinalizeState) {
          setOfficialState(rendererRef.current ? "running" : "idle");
        }
      }
    };

    setupQueueRef.current = setupQueueRef.current.catch(() => undefined).then(setupRenderer);

    return () => {
      cancelled = true;
    };
  }, [
    reportRendererFailure,
    retryNonce,
    setOfficialState,
    startWatchdog,
    viewportReady,
    viewportSize.height,
    viewportSize.width,
    releaseRendererSafely,
  ]);

  useEffect(() => {
    if (rendererState !== "initializing") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (unmountedRef.current || rendererStateRef.current !== "initializing") {
        return;
      }
      reportRendererFailure(new Error("Official renderer initialization timed out."), "init", true);
    }, RENDERER_INIT_TIMEOUT_MS + 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [rendererState, reportRendererFailure]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (terrainKeyRef.current !== terrainKey) {
      const appliedTerrain = runRendererAction(
        "resource",
        (renderer) => {
          renderer.setTerrain(terrainObjects);
        },
        {
          fatal: true,
          nextState: "degraded",
          fallbackMessage: "Failed to set official renderer terrain.",
        }
      );
      if (!appliedTerrain) {
        return;
      }

      terrainKeyRef.current = terrainKey;
      interactedRef.current = false;
      centerView(getFitZoomForRenderer(rendererRef.current));
    }

    const liveObjects = filterSupportedObjects(rendererObjects, supportedObjectTypesRef.current);
    const liveUsers = filterUsersByObjects(rendererUsers, liveObjects);
    const appliedState = runRendererAction(
      "frame",
      (renderer) => {
        renderer.applyState(
          {
            objects: liveObjects,
            users: liveUsers,
            gameTime,
          },
          0
        );
      },
      {
        fallbackMessage: "Failed to apply official renderer state.",
      }
    );
    if (appliedState) {
      setLoadError(null);
    }
  }, [
    centerView,
    gameTime,
    getFitZoomForRenderer,
    isReady,
    rendererObjects,
    rendererUsers,
    runRendererAction,
    terrainKey,
    terrainObjects,
  ]);

  useEffect(() => {
    if (!isReady || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    const resized = runRendererAction(
      "resource",
      (renderer) => {
        renderer.resize({
          width: viewportSize.width,
          height: viewportSize.height,
        });
      },
      {
        fatal: true,
        nextState: "degraded",
        fallbackMessage: "Failed to resize official renderer.",
      }
    );
    if (!resized) {
      return;
    }
    if (!interactedRef.current) {
      centerView(getFitZoomForRenderer(rendererRef.current));
    }
  }, [centerView, getFitZoomForRenderer, isReady, runRendererAction, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const host = rendererHostRef.current;
    const canvas = host?.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const onContextLost = (event: Event) => {
      if (rendererStateRef.current !== "running" || !rendererRef.current) {
        return;
      }

      event.preventDefault();
      hardKillRenderer("Official renderer WebGL context was lost.", "filter", "destroyed");
    };

    canvas.addEventListener("webglcontextlost", onContextLost, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
    };
  }, [hardKillRenderer, isReady]);

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      if (rendererStateRef.current !== "running" || !rendererRef.current) {
        return;
      }

      const message = [event.message, event.error instanceof Error ? event.error.stack : ""]
        .filter(Boolean)
        .join("\n");
      if (!isLikelyRendererSource(message)) {
        return;
      }
      reportRendererFailure(event.error ?? event.message, "frame", true);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (rendererStateRef.current !== "running" || !rendererRef.current) {
        return;
      }

      const reason = event.reason;
      const message =
        reason instanceof Error
          ? [reason.message, reason.stack].filter(Boolean).join("\n")
          : typeof reason === "string"
            ? reason
            : "";
      if (!isLikelyRendererSource(message)) {
        return;
      }
      reportRendererFailure(reason, "frame", true);
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [reportRendererFailure]);

  useEffect(() => {
    return registerConsoleErrorListener((args) => {
      if (rendererStateRef.current !== "running" || !rendererRef.current) {
        return;
      }
      if (!shouldTreatConsoleErrorAsRendererFatal(args)) {
        return;
      }
      hardKillRenderer("Official renderer stopped after shader/filter failure.", "filter", "destroyed");
    });
  }, [hardKillRenderer]);

  const zoomIn = useCallback(() => {
    interactedRef.current = true;
    applyZoom(zoom * ZOOM_STEP);
  }, [applyZoom, zoom]);

  const zoomOut = useCallback(() => {
    interactedRef.current = true;
    applyZoom(zoom / ZOOM_STEP);
  }, [applyZoom, zoom]);

  const resetView = useCallback(() => {
    interactedRef.current = false;
    centerView(getFitZoomForRenderer(rendererRef.current));
  }, [centerView, getFitZoomForRenderer]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!isReady) {
        return;
      }
      event.preventDefault();

      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const focusX = event.clientX - rect.left;
      const focusY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      interactedRef.current = true;
      applyZoom(zoom * factor, focusX, focusY);
    },
    [applyZoom, isReady, zoom]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isReady) {
        return;
      }

      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isReady]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragging = dragRef.current;
      if (!dragging || dragging.pointerId !== event.pointerId || !isReady) {
        return;
      }

      const deltaX = event.clientX - dragging.x;
      const deltaY = event.clientY - dragging.y;
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      interactedRef.current = true;
      runRendererAction(
        "frame",
        (renderer) => {
          renderer.pan(deltaX, deltaY);
        },
        {
          fallbackMessage: "Failed to pan official renderer.",
        }
      );
    },
    [isReady, runRendererAction]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragging = dragRef.current;
    if (dragging && dragging.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const roomLabel = roomShard ? `${roomName} @ ${roomShard}` : roomName;
  const renderProfileLabel = renderProfile === "safe" ? "safe mode" : "full mode";
  const fallbackMessage =
    loadError ??
    (rendererState === "destroyed"
      ? `Official renderer was stopped in ${renderProfileLabel} to keep this page responsive.`
      : rendererState === "degraded"
        ? `Official renderer failed in ${renderProfileLabel} for this page.`
        : `Loading official map renderer (${renderProfileLabel}): ${roomLabel}`);

  return (
    <div className="room-game-map room-game-map-official">
      <div className="room-game-map-toolbar">
        <span className="room-game-map-zoom">{Math.round(zoom * 100)}%</span>
        <button className="ghost-button room-game-map-tool" type="button" onClick={zoomOut} disabled={!isReady}>
          -
        </button>
        <button className="ghost-button room-game-map-tool" type="button" onClick={zoomIn} disabled={!isReady}>
          +
        </button>
        <button className="ghost-button room-game-map-tool" type="button" onClick={resetView} disabled={!isReady}>
          Reset
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`room-game-map-viewport room-game-map-viewport-official${isDragging ? " is-dragging" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label={`${roomLabel} official gameplay map`}
      >
        <div ref={rendererHostRef} className="room-official-map-host" />
        {!isReady ? (
          <div className="room-game-map-fallback" role="status" aria-live="polite">
            <div className="room-game-map-fallback-panel">
              <p>{fallbackMessage}</p>
              {isTerminalFailure ? (
                <div className="room-game-map-fallback-actions">
                  <button className="ghost-button room-game-map-tool" type="button" onClick={retryOfficialRenderer}>
                    Retry official renderer
                  </button>
                  <button
                    className="ghost-button room-game-map-tool"
                    type="button"
                    onClick={switchToOptimizedRenderer}
                  >
                    Switch to optimized renderer
                  </button>
                  <Link className="ghost-button room-game-map-tool" href="/settings">
                    Open settings
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
