import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Shared pointer-gesture handling for the room map viewports:
 * - single pointer drag -> pan
 * - two pointer pinch   -> zoom around the pinch midpoint + pan
 *
 * Wheel zoom is handled separately with a native non-passive listener
 * (see useMapWheelZoom) because React's synthetic wheel events are passive.
 */

export interface MapPointerGestureOptions {
  enabled: boolean;
  /** Element that bounds gesture coordinates (usually the map viewport). */
  viewportRef: React.RefObject<HTMLElement | null>;
  onPan: (deltaX: number, deltaY: number) => void;
  /**
   * @param factor zoom multiplier relative to the current zoom level
   * @param focusX pinch midpoint X within the viewport (CSS px)
   * @param focusY pinch midpoint Y within the viewport (CSS px)
   * @param panX midpoint movement since the last event
   * @param panY midpoint movement since the last event
   */
  onPinch: (factor: number, focusX: number, focusY: number, panX: number, panY: number) => void;
  onInteractionStart?: () => void;
}

interface TrackedPointer {
  x: number;
  y: number;
}

interface PinchBaseline {
  distance: number;
  midX: number;
  midY: number;
}

const MIN_PINCH_DISTANCE = 8;

export function useMapPointerGestures(options: MapPointerGestureOptions) {
  const { enabled, viewportRef, onInteractionStart } = options;
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const pinchBaselineRef = useRef<PinchBaseline | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!enabled) {
      pointersRef.current.clear();
      pinchBaselineRef.current = null;
      setIsActive(false);
    }
  }, [enabled]);

  const localPoint = useCallback(
    (clientX: number, clientY: number): TrackedPointer => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) {
        return { x: clientX, y: clientY };
      }
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [viewportRef]
  );

  const recomputeBaseline = useCallback((): void => {
    const pointers = pointersRef.current;
    if (pointers.size < 2) {
      pinchBaselineRef.current = null;
      return;
    }
    const [first, second] = [...pointers.values()];
    pinchBaselineRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2,
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!optionsRef.current.enabled || event.button !== 0) {
        return;
      }

      pointersRef.current.set(event.pointerId, localPoint(event.clientX, event.clientY));
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; gestures still work without it.
      }

      if (pointersRef.current.size >= 2) {
        pinchBaselineRef.current = null; // recomputed on first move
        onInteractionStart?.();
      }
      setIsActive(true);
    },
    [localPoint, onInteractionStart]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const pointers = pointersRef.current;
      const tracked = pointers.get(event.pointerId);
      if (!tracked || !optionsRef.current.enabled) {
        return;
      }

      const next = localPoint(event.clientX, event.clientY);
      const deltaX = next.x - tracked.x;
      const deltaY = next.y - tracked.y;
      pointers.set(event.pointerId, next);

      if (pointers.size < 2) {
        optionsRef.current.onPan(deltaX, deltaY);
        return;
      }

      // Pinch: recompute the baseline lazily so the gesture starts smoothly
      // even if a pointer moved between press and the second press.
      let baseline = pinchBaselineRef.current;
      if (!baseline || baseline.distance < MIN_PINCH_DISTANCE) {
        recomputeBaseline();
        baseline = pinchBaselineRef.current;
        return;
      }

      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;

      if (distance >= MIN_PINCH_DISTANCE && baseline.distance >= MIN_PINCH_DISTANCE) {
        const factor = distance / baseline.distance;
        if (Number.isFinite(factor) && factor > 0) {
          optionsRef.current.onPinch(factor, midX, midY, midX - baseline.midX, midY - baseline.midY);
        }
      }

      pinchBaselineRef.current = { distance, midX, midY };
    },
    [localPoint, recomputeBaseline]
  );

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const pointers = pointersRef.current;
      if (!pointers.has(event.pointerId)) {
        return;
      }
      pointers.delete(event.pointerId);
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore release failures.
      }

      if (pointers.size === 0) {
        pinchBaselineRef.current = null;
        setIsActive(false);
        return;
      }
      // Going from pinch back to pan: drop the stale pinch baseline.
      pinchBaselineRef.current = null;
      recomputeBaseline();
    },
    [recomputeBaseline]
  );

  return {
    isActive,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: releasePointer,
    handlePointerCancel: releasePointer,
  };
}

/**
 * Attaches a native non-passive wheel listener so preventDefault works
 * (React synthetic wheel handlers cannot call preventDefault reliably).
 */
export function useMapWheelZoom(options: {
  enabled: boolean;
  viewportRef: React.RefObject<HTMLElement | null>;
  onZoom: (factor: number, focusX: number, focusY: number) => void;
}): void {
  const { enabled, viewportRef, onZoom } = options;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !enabled) {
      return;
    }

    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      onZoomRef.current(factor, event.clientX - rect.left, event.clientY - rect.top);
    };

    viewport.addEventListener("wheel", handler, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handler);
    };
  }, [enabled, viewportRef]);
}
