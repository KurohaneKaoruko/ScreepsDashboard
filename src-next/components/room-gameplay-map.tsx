"use client";

import Link from "next/link";
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { useSettingsStore, type MapRendererMode } from "../stores/settings-store";
import { RoomGameplayMap as RoomGameplayMapOfficial } from "./room-gameplay-map-official";
import { RoomGameplayMap as RoomGameplayMapOptimized } from "./room-gameplay-map-optimized";
import type { RoomObjectSummary } from "../lib/screeps/types";

interface RoomGameplayMapProps {
  encoded?: string;
  roomName: string;
  roomShard?: string;
  gameTime?: number;
  roomObjects?: RoomObjectSummary[];
}

const RENDER_COMPONENT_BY_MODE: Record<MapRendererMode, ComponentType<RoomGameplayMapProps>> = {
  official: RoomGameplayMapOfficial,
  optimized: RoomGameplayMapOptimized,
};

interface OfficialRendererErrorBoundaryProps {
  roomLabel: string;
  children: ReactNode;
}

interface OfficialRendererErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

class OfficialRendererErrorBoundary extends Component<
  OfficialRendererErrorBoundaryProps,
  OfficialRendererErrorBoundaryState
> {
  state: OfficialRendererErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): OfficialRendererErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Official renderer crashed in React boundary.",
    };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Official renderer boundary captured an error:", error);
    }
  }

  componentDidUpdate(prevProps: OfficialRendererErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.roomLabel !== this.props.roomLabel) {
      this.setState({
        hasError: false,
        message: null,
      });
    }
  }

  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      message: null,
    });
  };

  private handleSwitchToOptimized = (): void => {
    useSettingsStore.getState().setMapRendererMode("optimized");
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.message ?? "Official renderer is disabled for this page instance.";
    return (
      <div className="room-game-map room-game-map-official">
        <div
          className="room-game-map-viewport room-game-map-viewport-official"
          role="img"
          aria-label={`${this.props.roomLabel} official gameplay map error`}
        >
          <div className="room-game-map-fallback" role="status" aria-live="polite">
            <div className="room-game-map-fallback-panel">
              <p>{message}</p>
              <div className="room-game-map-fallback-actions">
                <button className="ghost-button room-game-map-tool" type="button" onClick={this.handleRetry}>
                  Retry official renderer
                </button>
                <button
                  className="ghost-button room-game-map-tool"
                  type="button"
                  onClick={this.handleSwitchToOptimized}
                >
                  Switch to optimized renderer
                </button>
                <Link className="ghost-button room-game-map-tool" href="/settings">
                  Open settings
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export function RoomGameplayMap(props: RoomGameplayMapProps) {
  const mode = useSettingsStore((state) => state.mapRendererMode);
  if (mode === "official") {
    const roomLabel = props.roomShard ? `${props.roomName} @ ${props.roomShard}` : props.roomName;
    return (
      <OfficialRendererErrorBoundary roomLabel={roomLabel}>
        <RoomGameplayMapOfficial {...props} />
      </OfficialRendererErrorBoundary>
    );
  }

  const RendererComponent = RENDER_COMPONENT_BY_MODE[mode] ?? RoomGameplayMapOptimized;
  return <RendererComponent {...props} />;
}
