"use client";

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

interface RoomGameplayMapProps {
  encoded?: string;
  roomName: string;
  roomShard?: string;
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

const GRID_SIZE = 50;
const ROOM_VIEW_BOX = GRID_SIZE * 100;
const ROOM_CELL_SIZE = ROOM_VIEW_BOX / GRID_SIZE;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3.8;
const ZOOM_STEP = 1.15;
const DEFAULT_ZOOM = 1;

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

export function RoomGameplayMap({ encoded, roomName, roomShard, roomObjects }: RoomGameplayMapProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<RendererInstance | null>(null);
  const setupQueueRef = useRef<Promise<void>>(Promise.resolve());
  const setupAttemptRef = useRef(0);
  const releasedRenderersRef = useRef<WeakSet<object>>(new WeakSet<object>());
  const rendererStatusRef = useRef<"idle" | "initializing" | "ready" | "disposing">("idle");
  const supportedObjectTypesRef = useRef<Set<string>>(new Set<string>());
  const dragRef = useRef<DragState | null>(null);
  const interactedRef = useRef(false);
  const terrainKeyRef = useRef<string>("");

  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const gameTime = useMemo(() => Math.floor(Date.now() / 1000), [roomObjects, roomName, roomShard]);
  const terrainObjects = useMemo(() => decodeTerrainToObjects(encoded, roomName), [encoded, roomName]);
  const rendererObjects = useMemo(
    () => buildRendererObjects(roomName, roomObjects, gameTime),
    [roomName, roomObjects, gameTime]
  );
  const rendererUsers = useMemo(() => buildRendererUsers(roomObjects), [roomObjects]);
  const terrainKey = useMemo(() => `${roomName}:${encoded ?? ""}`, [roomName, encoded]);

  const updateZoomState = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    setZoom(renderer.zoomLevel);
  }, []);

  const centerView = useCallback(
    (targetZoom: number) => {
      const renderer = rendererRef.current as (RendererInstance & RendererInternals) | null;
      if (!renderer || !viewportRef.current) {
        return;
      }

      renderer.zoomLevel = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
      const viewBox = resolveRendererViewBox(renderer);
      const stagePosition = renderer.app?.stage?.position;
      if (stagePosition) {
        stagePosition.x = (viewportSize.width - viewBox * renderer.zoomLevel) / 2;
        stagePosition.y = (viewportSize.height - viewBox * renderer.zoomLevel) / 2;
      }
      updateZoomState();
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
      if (!renderer || !viewportRef.current) {
        return;
      }

      const viewportRect = viewportRef.current.getBoundingClientRect();
      const focusX = anchorX ?? viewportRect.width / 2;
      const focusY = anchorY ?? viewportRect.height / 2;
      renderer.zoomTo(clamp(targetZoom, MIN_ZOOM, MAX_ZOOM), focusX, focusY);
      updateZoomState();
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

  useEffect(() => {
    return () => {
      setupAttemptRef.current += 1;
      rendererStatusRef.current = "disposing";

      const mountedRenderer = rendererRef.current;
      rendererRef.current = null;
      releaseRendererSafely(mountedRenderer);

      supportedObjectTypesRef.current = new Set<string>();
      terrainKeyRef.current = "";

      const host = rendererHostRef.current;
      if (host) {
        host.textContent = "";
      }
    };
  }, [releaseRendererSafely]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const refreshViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    refreshViewportSize();
    const observer = new ResizeObserver(refreshViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || rendererRef.current) {
      return;
    }

    let cancelled = false;
    const setupId = setupAttemptRef.current + 1;
    setupAttemptRef.current = setupId;

    const setupRenderer = async () => {
      if (cancelled || setupId !== setupAttemptRef.current || rendererRef.current) {
        return;
      }

      const host = rendererHostRef.current;
      if (!host) {
        return;
      }

      rendererStatusRef.current = "initializing";
      setIsReady(false);
      setLoadError(null);

      try {
        const rendererModule = (await import("@screeps/renderer")) as RendererModule;
        if (rendererModule.PIXI) {
          installPixiUvsGuards(rendererModule.PIXI);
          (globalThis as Record<string, unknown>).PIXI = rendererModule.PIXI;
        }

        await import("@screeps/renderer-metadata");
        const rendererMetadata = (globalThis as Record<string, unknown>).RENDERER_METADATA as
          | RendererMetadata
          | undefined;

        const GameRenderer = getModuleGameRenderer(rendererModule);
        if (!GameRenderer || !rendererMetadata) {
          throw new Error("Official Screeps renderer is unavailable.");
        }
        supportedObjectTypesRef.current = new Set(Object.keys(rendererMetadata.objects ?? {}));

        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (
            cancelled ||
            setupId !== setupAttemptRef.current ||
            rendererRef.current
          ) {
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
              lighting: "normal",
            },
          });

          await renderer.init(host);
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
          rendererStatusRef.current = "ready";
          setIsReady(true);
          return;
        }
      } catch (error) {
        if (cancelled || setupId !== setupAttemptRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load official map renderer.";
        setIsReady(false);
        setLoadError(message);
      } finally {
        if (rendererStatusRef.current === "initializing") {
          rendererStatusRef.current = rendererRef.current ? "ready" : "idle";
        }
      }
    };

    setupQueueRef.current = setupQueueRef.current
      .catch(() => undefined)
      .then(setupRenderer);

    return () => {
      cancelled = true;
    };
  }, [
    releaseRendererSafely,
    viewportSize.height,
    viewportSize.width,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isReady) {
      return;
    }

    if (terrainKeyRef.current !== terrainKey) {
      renderer.setTerrain(terrainObjects);
      terrainKeyRef.current = terrainKey;
      interactedRef.current = false;
      centerView(getFitZoomForRenderer(renderer));
    }

    const liveObjects = filterSupportedObjects(rendererObjects, supportedObjectTypesRef.current);
    const liveUsers = filterUsersByObjects(rendererUsers, liveObjects);
    try {
      renderer.applyState(
        {
          objects: liveObjects,
          users: liveUsers,
          gameTime,
        },
        0
      );
      setLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply renderer state.";
      renderer.applyState(
        {
          objects: [],
          users: {},
          gameTime,
        },
        0
      );
      setLoadError(message);
    }
  }, [centerView, gameTime, getFitZoomForRenderer, isReady, rendererObjects, rendererUsers, terrainKey, terrainObjects]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isReady || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    renderer.resize({
      width: viewportSize.width,
      height: viewportSize.height,
    });
    if (!interactedRef.current) {
      centerView(getFitZoomForRenderer(renderer));
    }
  }, [centerView, getFitZoomForRenderer, isReady, viewportSize.height, viewportSize.width]);

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
    [applyZoom, zoom]
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragging = dragRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId) {
      return;
    }

    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }

    const deltaX = event.clientX - dragging.x;
    const deltaY = event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    interactedRef.current = true;
    renderer.pan(deltaX, deltaY);
  }, []);

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

  return (
    <div className="room-game-map room-game-map-official">
      <div className="room-game-map-toolbar">
        <span className="room-game-map-zoom">{Math.round(zoom * 100)}%</span>
        <button className="ghost-button room-game-map-tool" type="button" onClick={zoomOut}>
          -
        </button>
        <button className="ghost-button room-game-map-tool" type="button" onClick={zoomIn}>
          +
        </button>
        <button className="ghost-button room-game-map-tool" type="button" onClick={resetView}>
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
          <div className="room-game-map-fallback">
            {loadError ? loadError : `Loading official map renderer: ${roomLabel}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}
