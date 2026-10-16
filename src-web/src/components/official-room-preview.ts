/**
 * Renders a single room offscreen with the *official* Screeps renderer
 * (`@screeps/renderer` — the same engine the game client uses) and hands the
 * result back as a plain canvas.
 *
 * The world map uses this to paint real room content (terrain, structures,
 * creeps) instead of flat owner-coloured tiles. A single renderer instance is
 * shared and reused for every room: each room is applied as a state change and
 * extracted to a canvas, which keeps the number of WebGL contexts at one no
 * matter how many rooms the map shows.
 */
import { SCREEPS_RENDERER_RESOURCE_MAP } from "../lib/screeps/renderer-resource-map";
import type { OfficialRoomObjectRecord, OfficialRoomUserRecord } from "../lib/screeps/types";
import {
  GRID_SIZE,
  RENDERER_INIT_TIMEOUT_MS,
  ROOM_VIEW_BOX,
  buildRendererObjectsFromOfficial,
  buildRendererUsersFromOfficial,
  createOfficialGameData,
  decodeTerrainToObjects,
  filterSupportedObjects,
  filterUsersByObjects,
  getModuleGameRenderer,
  hasPixiAssetAlias,
  installPixiUvsGuards,
  resolveCurrentPlayerFromOfficialUsers,
  type RendererInstance,
  type RendererMetadata,
  type RendererModule,
  type RendererUserState,
} from "./room-gameplay-map-official";

/**
 * Side length of a rendered room preview, in device pixels. A room tile is at
 * most `CELL_BASE_PX * MAX_ZOOM` = 200 CSS px, so 512 device pixels stays sharp
 * even on a 2x display.
 */
export const ROOM_PREVIEW_PIXELS = 512;

/**
 * Runtime creation pulls in the whole renderer plus ~100 sprite sheets, so a
 * cold (or throttled) tab can legitimately need more than the general renderer
 * timeout. A slow start must not permanently disable the previews.
 */
const PREVIEW_INIT_TIMEOUT_MS = 20_000;

/** Runtime creation attempts before the previews are considered unusable. */
const MAX_RUNTIME_ATTEMPTS = 3;

/**
 * The official renderer *requires* a `BADGE_URL` template whenever a state
 * carries users: its `setBadgeUrls` preprocessor runs on every `applyState` and
 * calls `BADGE_URL.replace('%1', username)`. Without it, any room that contains
 * owned objects throws. A transparent inline SVG keeps the renderer usable even
 * when no server URL is known.
 */
const FALLBACK_BADGE_URL =
  "data:image/svg+xml;charset=utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>'
  );

/** Builds the badge URL template a Screeps server exposes for a username. */export function buildRoomPreviewBadgeUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return FALLBACK_BADGE_URL;
  }
  return `${trimmed}/api/user/badge-svg?username=%1`;
}

let activeBadgeUrl = FALLBACK_BADGE_URL;
let activeLighting: RoomPreviewLighting = "normal";

/**
 * Selects the badge endpoint used by subsequent renders, e.g.
 * `https://screeps.com/api/user/badge-svg?username=%1`, and the lighting
 * profile (`"normal"` matches the game client, `"disabled"` is brighter and
 * easier to read on small map tiles). Changing either drops the shared
 * renderer so the next render is built with the new settings.
 */
export function configureRoomPreviewRenderer(options: {
  badgeUrl?: string;
  lighting?: RoomPreviewLighting;
}): void {
  const nextBadge = options.badgeUrl?.trim() ? options.badgeUrl.trim() : FALLBACK_BADGE_URL;
  const nextLighting = options.lighting ?? activeLighting;
  if (nextBadge === activeBadgeUrl && nextLighting === activeLighting) {
    return;
  }
  activeBadgeUrl = nextBadge;
  activeLighting = nextLighting;
  disposeRoomPreviewRenderer();
}

/** Lighting profiles the official renderer understands. */
export type RoomPreviewLighting = "normal" | "disabled";

/** Minimal shape needed to describe a room to the preview renderer. */
export interface RoomPreviewRequest {
  room: string;
  terrainEncoded?: string;
  officialObjects?: OfficialRoomObjectRecord[];
  officialUsers?: Record<string, OfficialRoomUserRecord>;
  gameTime?: number;
  currentUsername?: string;
  currentUserId?: string;
}

interface PreviewRuntime {
  renderer: RendererInstance;
  host: HTMLDivElement;
  metadata: RendererMetadata;
  supportedTypes: Set<string>;
}

/** The renderer exposes Pixi internals that are not part of the public typings. */
interface PreviewInternals {
  app?: {
    canvas?: HTMLCanvasElement;
    view?: HTMLCanvasElement;
    render?: () => void;
    stage?: { position?: { x: number; y: number } };
  };
  world?: {
    options?: Record<string, unknown>;
    removeAllObjects?: () => void;
  };
}

let runtime: PreviewRuntime | null = null;
let runtimePromise: Promise<PreviewRuntime | null> | null = null;
let runtimeUnavailable = false;
/** Serialises renders: the shared renderer handles one room at a time. */
let renderChain: Promise<unknown> = Promise.resolve();

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function readRendererMetadata(): RendererMetadata | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const scope = window as unknown as Record<string, unknown>;
  const candidate = scope.RENDERER_METADATA ?? (globalThis as Record<string, unknown>).RENDERER_METADATA;
  return candidate && typeof candidate === "object" ? (candidate as RendererMetadata) : undefined;
}

async function createRuntime(): Promise<PreviewRuntime | null> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const module = (await withTimeout(
    import("@screeps/renderer") as Promise<RendererModule>,
    RENDERER_INIT_TIMEOUT_MS,
    "Official renderer module load timed out."
  )) as RendererModule;

  if (module.PIXI) {
    installPixiUvsGuards(module.PIXI);
    (globalThis as Record<string, unknown>).PIXI = module.PIXI;
    (window as unknown as Record<string, unknown>).PIXI = module.PIXI;
  }

  await withTimeout(
    import("@screeps/renderer-metadata"),
    RENDERER_INIT_TIMEOUT_MS,
    "Official renderer metadata load timed out."
  );

  const metadata = readRendererMetadata();
  const metadataObjects = metadata?.objects;
  const GameRenderer = getModuleGameRenderer(module);
  if (!GameRenderer || !metadata || !metadataObjects || Object.keys(metadataObjects).length === 0) {
    throw new Error("Official Screeps renderer is unavailable.");
  }

  // Offscreen but still rendered by the browser: `display:none` would stop Pixi
  // from sizing its canvas.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${ROOM_PREVIEW_PIXELS}px`,
    `height:${ROOM_PREVIEW_PIXELS}px`,
    "pointer-events:none",
    "overflow:hidden",
  ].join(";");
  document.body.appendChild(host);

  const renderer = new GameRenderer({
    autoFocus: false,
    // The previews are static snapshots, so no animation loop is needed. This
    // also avoids depending on requestAnimationFrame, which browsers pause for
    // hidden/backgrounded documents.
    autoStart: false,
    useDefaultLogger: false,
    size: { width: ROOM_PREVIEW_PIXELS, height: ROOM_PREVIEW_PIXELS },
    resourceMap: SCREEPS_RENDERER_RESOURCE_MAP,
    worldConfigs: {
      metadata,
      ROOM_SIZE: GRID_SIZE,
      CELL_SIZE: ROOM_VIEW_BOX / GRID_SIZE,
      HALF_CELL_SIZE: ROOM_VIEW_BOX / GRID_SIZE / 2,
      VIEW_BOX: ROOM_VIEW_BOX,
      RENDER_SIZE: { width: ROOM_VIEW_BOX, height: ROOM_VIEW_BOX },
      gameData: createOfficialGameData(),
      lighting: activeLighting,
      BADGE_URL: activeBadgeUrl,
    },
  });

  try {
    await withTimeout(
      renderer.init(host),
      PREVIEW_INIT_TIMEOUT_MS,
      "Official renderer initialization timed out."
    );
  } catch (error) {
    // Half-initialised runtimes used to leak their offscreen host (and its
    // WebGL context) for the rest of the session.
    try {
      renderer.release();
    } catch {
      // Best effort: the host still has to go.
    }
    host.textContent = "";
    host.remove();
    throw error;
  }

  if (!hasPixiAssetAlias(module.PIXI, "glow")) {
    renderer.release();
    host.textContent = "";
    host.remove();
    throw new Error("Official renderer resources failed to initialize.");
  }

  // Fit the whole 5000px room into the square preview canvas.
  renderer.zoomLevel = ROOM_PREVIEW_PIXELS / ROOM_VIEW_BOX;

  return {
    renderer,
    host,
    metadata,
    supportedTypes: new Set(Object.keys(metadataObjects)),
  };
}

/** Counts failed runtime creations; a slow first start must not be fatal. */
let runtimeFailures = 0;

function markUnavailable(): void {
  runtimeFailures += 1;
  if (runtimeFailures >= MAX_RUNTIME_ATTEMPTS) {
    runtimeUnavailable = true;
  }
}

/** True while the official renderer is believed to be usable. */
export function isRoomPreviewSupported(): boolean {
  return !runtimeUnavailable;
}

/**
 * Loads (once) and returns the shared preview runtime. Returns `null` when the
 * official renderer cannot be used in this environment.
 */
export async function ensureRoomPreviewRenderer(): Promise<PreviewRuntime | null> {
  if (runtime) {
    return runtime;
  }
  if (runtimeUnavailable) {
    return null;
  }
  if (!runtimePromise) {
    runtimePromise = createRuntime()
      .then((created) => {
        runtime = created;
        runtimeFailures = 0;
        return created;
      })
      .catch(() => {
        markUnavailable();
        return null;
      })
      .finally(() => {
        runtimePromise = null;
      });
  }
  return runtimePromise;
}

/**
 * Renders the stage to the renderer's own canvas and copies it out.
 *
 * `extract.canvas(stage)` cannot be used directly: it works off the stage's
 * *local* bounds (5000x5000 here, which also blows past GPU texture limits).
 * Rendering straight into a custom render target is also unreliable with the
 * `@pixi/layers` pipeline the official renderer uses (objects silently vanish
 * from the output), so the frame is read back from the screen canvas instead —
 * the same path the game client renders through.
 */
function extractStageCanvas(active: PreviewRuntime): HTMLCanvasElement | null {
  const internals = active.renderer as unknown as PreviewInternals;
  const app = internals.app;
  const source = app?.view ?? app?.canvas;
  if (!app?.render || !source) {
    return null;
  }
  try {
    applyCameraReset(active.renderer);
    // The first frame after a state change can miss the `@pixi/layers` render
    // groups the official renderer routes objects through, so render twice and
    // keep the second frame.
    app.render();
    app.render();
    const output = document.createElement("canvas");
    output.width = ROOM_PREVIEW_PIXELS;
    output.height = ROOM_PREVIEW_PIXELS;
    const ctx = output.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(source, 0, 0, ROOM_PREVIEW_PIXELS, ROOM_PREVIEW_PIXELS);
    return output;
  } catch {
    return null;
  }
}

function applyCameraReset(renderer: RendererInstance): void {
  const internals = renderer as unknown as PreviewInternals;
  const position = internals.app?.stage?.position;
  if (position) {
    position.x = 0;
    position.y = 0;
  }
  renderer.zoomLevel = ROOM_PREVIEW_PIXELS / ROOM_VIEW_BOX;
}

/**
 * Mean luminance above which a frame is considered "washed": the official
 * renderer's lighting pass silently stops being drawn now and then (the frame
 * then shows flat, over-bright terrain with no objects on it). Correctly lit
 * room frames sit far below this threshold.
 */
const WASHED_FRAME_LUMA = 66;

/**
 * Rendering failures are swallowed into a `null` frame so the map can keep
 * running, which makes them invisible in the UI. The first one is reported once
 * per session to keep the cause discoverable.
 */
let warnedRenderFailure = false;

function reportRenderFailure(error: unknown): void {
  if (warnedRenderFailure) {
    return;
  }
  warnedRenderFailure = true;
  console.warn("[official-room-preview] room render failed:", error);
}

function looksWashed(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return false;
  }
  try {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    let samples = 0;
    // Every 16th byte ≈ every 4th pixel; enough to spot a flat bright frame.
    for (let i = 0; i + 2 < data.length; i += 16) {
      total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      samples += 1;
    }
    return samples > 0 && total / samples > WASHED_FRAME_LUMA;
  } catch {
    return false;
  }
}

/**
 * Renders one room and returns its snapshot, or `null` when the room has no
 * usable data / the renderer is unavailable.
 */
export async function renderRoomPreview(
  request: RoomPreviewRequest
): Promise<HTMLCanvasElement | null> {
  const active = await ensureRoomPreviewRenderer();
  if (!active) {
    return null;
  }

  const objects = filterSupportedObjects(
    buildRendererObjectsFromOfficial(request.room, request.officialObjects, undefined),
    active.supportedTypes
  );
  const terrainObjects = decodeTerrainToObjects(request.terrainEncoded, request.room);
  if (objects.length === 0 && terrainObjects.length === 0) {
    return null;
  }

  const usersResult = buildRendererUsersFromOfficial(
    request.officialUsers ?? {},
    undefined,
    request.currentUsername,
    request.currentUserId
  );
  const users: Record<string, RendererUserState> = filterUsersByObjects(
    usersResult.users,
    objects
  );
  const player =
    usersResult.playerId ??
    resolveCurrentPlayerFromOfficialUsers(
      request.officialUsers ?? {},
      request.currentUsername,
      request.currentUserId
    );

  // The shared renderer is not re-entrant, so renders are chained.
  const run = renderChain.then(async () => {
    const renderFrame = (): HTMLCanvasElement | null => {
      const internals = active.renderer as unknown as PreviewInternals;
      const worldOptions = internals.world?.options as Record<string, unknown> | undefined;
      if (worldOptions) {
        worldOptions.gameData = createOfficialGameData(player);
      }
      // Rooms are rendered back to back into one renderer, so start from a
      // clean slate: a state that failed halfway must not leak into the next
      // room's frame. Terrain is re-applied below either way.
      try {
        internals.world?.removeAllObjects?.();
      } catch {
        // A failed reset is non-fatal; applyState still reconciles objects.
      }
      applyCameraReset(active.renderer);
      active.renderer.setTerrain(terrainObjects);
      active.renderer.applyState(
        {
          objects,
          users,
          gameTime: request.gameTime ?? 0,
        },
        0
      );
      return extractStageCanvas(active);
    };

    try {
      let frame = renderFrame();
      if (frame && objects.length > 0 && looksWashed(frame)) {
        // The lighting/object layers dropped out of this frame. Re-applying the
        // whole scene rebuilds the layer groups; only a clean retry replaces the
        // first frame, so a good frame can never be downgraded by the retry.
        const retry = renderFrame();
        if (retry && !looksWashed(retry)) {
          frame = retry;
        }
      }
      return frame;
    } catch (error) {
      reportRenderFailure(error);
      return null;
    }
  });
  // Keep the chain alive even when a render rejects.
  renderChain = run.catch(() => undefined);
  return run;
}

/** Releases the shared renderer. Called when the last consumer unmounts. */
export function disposeRoomPreviewRenderer(): void {
  const active = runtime;
  runtime = null;
  runtimePromise = null;
  runtimeFailures = 0;
  if (!active) {
    return;
  }
  try {
    active.renderer.release();
  } catch {
    // Best effort: a failed release must not break navigation.
  }
  active.host.textContent = "";
  active.host.remove();
}
