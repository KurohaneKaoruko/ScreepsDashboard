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
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_RENDERER_INIT_SIZE,
  MIN_ZOOM,
  ROOM_VIEW_BOX,
  buildNormalizedObjects,
  clamp,
  collectRequiredAliases,
  decodeTerrainValues,
  getFitZoom,
  type CameraState,
  type NormalizedRenderObject,
  type ViewportSize,
} from "../lib/screeps/optimized-renderer-runtime";
import {
  createOptimizedPixiRuntime,
  type OptimizedPixiRuntime,
} from "../lib/screeps/optimized-pixi-runtime";
import type { RoomObjectSummary } from "../lib/screeps/types";

interface RoomGameplayMapProps {
  encoded?: string;
  roomName: string;
  roomShard?: string;
  gameTime?: number;
  roomObjects?: RoomObjectSummary[];
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
}

type SpriteAtlasState = "idle" | "loading" | "ready" | "error";

const ZOOM_STEP = 1.15;

function resolveGameTime(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return Date.now() / 1000;
}

export function RoomGameplayMap({
  encoded,
  roomName,
  roomShard,
  gameTime,
  roomObjects,
}: RoomGameplayMapProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<OptimizedPixiRuntime | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const interactedRef = useRef(false);
  const cameraRef = useRef<CameraState>({
    zoom: DEFAULT_ZOOM,
    offsetX: 0,
    offsetY: 0,
  });
  const autoCenteredKeyRef = useRef("");
  const terrainKeyRef = useRef("");
  const renderObjectsRef = useRef<NormalizedRenderObject[]>([]);
  const gameTimeRef = useRef(resolveGameTime(gameTime));
  const unmountedRef = useRef(false);

  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [atlasState, setAtlasState] = useState<SpriteAtlasState>("idle");
  const [atlasError, setAtlasError] = useState<string | null>(null);
  const [runtimeNonce, setRuntimeNonce] = useState(0);

  const viewportReady =
    viewportSize.width >= MIN_RENDERER_INIT_SIZE &&
    viewportSize.height >= MIN_RENDERER_INIT_SIZE;

  const terrainValues = useMemo(() => decodeTerrainValues(encoded), [encoded]);
  const terrainKey = useMemo(() => `${roomName}:${encoded ?? ""}`, [roomName, encoded]);
  const renderObjects = useMemo(() => buildNormalizedObjects(roomObjects), [roomObjects]);
  const hasAnimatedObjects = useMemo(
    () =>
      renderObjects.some(
        (item) =>
          Boolean(item.actionLog) ||
          Boolean(item.say) ||
          (typeof item.spawningNeedTime === "number" && item.spawningNeedTime > 0) ||
          (typeof item.cooldownTime === "number" && Number.isFinite(item.cooldownTime))
      ),
    [renderObjects]
  );
  const requiredAliases = useMemo(() => collectRequiredAliases(renderObjects), [renderObjects]);
  const requiredAliasKey = useMemo(
    () => requiredAliases.slice().sort((left, right) => left.localeCompare(right)).join("|"),
    [requiredAliases]
  );

  const renderNow = useCallback((time?: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.renderFrame(time ?? gameTimeRef.current);
  }, []);

  const syncCamera = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.setCamera(cameraRef.current);
  }, []);

  const centerView = useCallback(
    (targetZoom?: number) => {
      if (!viewportReady) {
        return;
      }
      const nextZoom = clamp(targetZoom ?? getFitZoom(viewportSize), MIN_ZOOM, MAX_ZOOM);
      const camera = cameraRef.current;
      camera.zoom = nextZoom;
      camera.offsetX = (viewportSize.width - ROOM_VIEW_BOX * nextZoom) * 0.5;
      camera.offsetY = (viewportSize.height - ROOM_VIEW_BOX * nextZoom) * 0.5;
      setZoom(nextZoom);
      syncCamera();
      renderNow();
    },
    [renderNow, syncCamera, viewportReady, viewportSize]
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const camera = cameraRef.current;
      camera.offsetX += deltaX;
      camera.offsetY += deltaY;
      syncCamera();
      renderNow();
    },
    [renderNow, syncCamera]
  );

  const applyZoom = useCallback(
    (targetZoom: number, focusX?: number, focusY?: number) => {
      const clampedZoom = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
      const camera = cameraRef.current;
      if (Math.abs(clampedZoom - camera.zoom) < 1e-6) {
        return;
      }

      const fallbackFocusX = viewportSize.width * 0.5;
      const fallbackFocusY = viewportSize.height * 0.5;
      const zoomFocusX = Number.isFinite(focusX) ? (focusX as number) : fallbackFocusX;
      const zoomFocusY = Number.isFinite(focusY) ? (focusY as number) : fallbackFocusY;

      const worldX = (zoomFocusX - camera.offsetX) / camera.zoom;
      const worldY = (zoomFocusY - camera.offsetY) / camera.zoom;
      camera.zoom = clampedZoom;
      camera.offsetX = zoomFocusX - worldX * clampedZoom;
      camera.offsetY = zoomFocusY - worldY * clampedZoom;
      setZoom(clampedZoom);
      syncCamera();
      renderNow();
    },
    [renderNow, syncCamera, viewportSize.height, viewportSize.width]
  );

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
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!viewportReady || runtimeRef.current || !rendererHostRef.current) {
      return;
    }

    let cancelled = false;
    setIsReady(false);
    setLoadError(null);

    void createOptimizedPixiRuntime({
      host: rendererHostRef.current,
      width: viewportSize.width,
      height: viewportSize.height,
    })
      .then((runtime) => {
        if (cancelled || unmountedRef.current) {
          runtime.destroy();
          return;
        }
        runtimeRef.current = runtime;
        runtime.setCamera(cameraRef.current);
        runtime.setTerrain(terrainValues, terrainKey);
        runtime.setState(renderObjectsRef.current, gameTimeRef.current);
        setIsReady(true);
        setLoadError(null);
        setRuntimeNonce((current) => current + 1);
      })
      .catch((error) => {
        if (cancelled || unmountedRef.current) {
          return;
        }
        setIsReady(false);
        setLoadError(error instanceof Error ? error.message : "Failed to initialize optimized pixi renderer.");
      });

    return () => {
      cancelled = true;
    };
  }, [terrainKey, terrainValues, viewportReady, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    gameTimeRef.current = resolveGameTime(gameTime);
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.setState(renderObjectsRef.current, gameTimeRef.current);
    setIsReady(true);
  }, [gameTime]);

  useEffect(() => {
    renderObjectsRef.current = renderObjects;
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.setState(renderObjects, gameTimeRef.current);
    setIsReady(true);
  }, [renderObjects]);

  useEffect(() => {
    if (terrainKeyRef.current === terrainKey) {
      return;
    }
    terrainKeyRef.current = terrainKey;
    autoCenteredKeyRef.current = "";

    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.setTerrain(terrainValues, terrainKey);
    runtime.setState(renderObjectsRef.current, gameTimeRef.current);
    setIsReady(true);
  }, [terrainKey, terrainValues]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !viewportReady) {
      setIsReady(false);
      return;
    }
    runtime.resize({ width: viewportSize.width, height: viewportSize.height });
    if (!interactedRef.current) {
      centerView(getFitZoom(viewportSize));
      return;
    }
    syncCamera();
    renderNow();
  }, [centerView, renderNow, syncCamera, viewportReady, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !viewportReady || !requiredAliasKey) {
      return;
    }

    let cancelled = false;
    setAtlasState("loading");
    setAtlasError(null);

    runtime
      .preloadAliases(requiredAliases)
      .then(() => {
        if (cancelled || unmountedRef.current) {
          return;
        }
        setAtlasState("ready");
        setAtlasError(null);
        runtime.renderFrame(gameTimeRef.current);
        setIsReady(true);
      })
      .catch((error) => {
        if (cancelled || unmountedRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load optimized pixi assets.";
        setAtlasState("error");
        setAtlasError(message);
        setLoadError((current) => current ?? message);
      });

    return () => {
      cancelled = true;
    };
  }, [requiredAliasKey, requiredAliases, runtimeNonce, viewportReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !viewportReady || atlasState !== "ready" || !hasAnimatedObjects) {
      return;
    }
    const timer = window.setInterval(() => {
      runtime.renderFrame(Date.now() / 1000);
    }, 80);
    return () => {
      window.clearInterval(timer);
    };
  }, [atlasState, hasAnimatedObjects, viewportReady]);

  useEffect(() => {
    if (!viewportReady || interactedRef.current) {
      return;
    }
    const key = `${terrainKey}:${viewportSize.width}x${viewportSize.height}`;
    if (autoCenteredKeyRef.current === key) {
      return;
    }
    autoCenteredKeyRef.current = key;
    centerView(getFitZoom(viewportSize));
  }, [centerView, terrainKey, viewportReady, viewportSize]);

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
    centerView(getFitZoom(viewportSize));
  }, [centerView, viewportSize]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!viewportReady) {
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
    [applyZoom, viewportReady, zoom]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !viewportReady) {
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
    [viewportReady]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragging = dragRef.current;
      if (!dragging || dragging.pointerId !== event.pointerId || !viewportReady) {
        return;
      }

      const deltaX = event.clientX - dragging.x;
      const deltaY = event.clientY - dragging.y;
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      interactedRef.current = true;
      panBy(deltaX, deltaY);
    },
    [panBy, viewportReady]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragging = dragRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const roomLabel = roomShard ? `${roomName} @ ${roomShard}` : roomName;
  const fallbackMessage =
    loadError ??
    atlasError ??
    (!viewportReady
      ? `Preparing map viewport: ${roomLabel}`
      : atlasState === "loading"
        ? `Loading pixi map assets: ${roomLabel}`
        : `Loading optimized pixi renderer: ${roomLabel}`);

  return (
    <div className="room-game-map room-game-map-official">
      <div className="room-game-map-toolbar">
        <span className="room-game-map-zoom">{Math.round(zoom * 100)}%</span>
        <button className="ghost-button room-game-map-tool" type="button" onClick={zoomOut} disabled={!viewportReady}>
          -
        </button>
        <button className="ghost-button room-game-map-tool" type="button" onClick={zoomIn} disabled={!viewportReady}>
          +
        </button>
        <button className="ghost-button room-game-map-tool" type="button" onClick={resetView} disabled={!viewportReady}>
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
        aria-label={`${roomLabel} optimized gameplay map`}
      >
        <div ref={rendererHostRef} className="room-official-map-host" />
        {!isReady ? (
          <div className="room-game-map-fallback" role="status" aria-live="polite">
            <div className="room-game-map-fallback-panel">
              <p>{fallbackMessage}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

