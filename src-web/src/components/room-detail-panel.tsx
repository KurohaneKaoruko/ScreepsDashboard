import { Link } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  mergeRoomDetailEvent,
  fetchRoomDetailSnapshot,
} from "../lib/screeps/room-detail";
import { ScreepsRealtimeClient } from "../lib/screeps/realtime-client";
import {
  normalizeShardName,
  resolveSubscriptionShards,
  useServerShards,
} from "../lib/screeps/shards";
import type { RoomDetailSnapshot } from "../lib/screeps/types";
import { RoomIntelligence, type RoomIntelTab } from "./room-intelligence";
import { RoomOperations } from "./room-operations";
import { useAuthStore } from "../stores/auth-store";
import { RoomGameplayMap } from "./room-gameplay-map";

interface RoomDetailPanelProps {
  roomName: string;
  roomShard?: string | null;
}

const ROOM_CHANNEL_PREFIX = "room:";

function normalizeShardValue(value: string | null | undefined): string | undefined {
  // Accepts private server shard names ("main", "season", custom) as well.
  return normalizeShardName(value ?? undefined);
}

function buildRoomRealtimeChannels(
  roomName: string,
  shard?: string,
  knownShards?: readonly string[]
): string[] {
  const normalizedRoom = roomName.trim().toUpperCase();
  if (!normalizedRoom) {
    return [];
  }

  const channels = new Set<string>([
    `room:${normalizedRoom}`,
    `room:${normalizedRoom.toLowerCase()}`,
  ]);

  const shards = resolveSubscriptionShards(shard, knownShards);
  for (const shardName of shards) {
    channels.add(`room:${shardName}/${normalizedRoom}`);
  }

  return [...channels];
}

function parseRoomRealtimeChannel(
  channel: string
): { roomName: string; shard?: string } | null {
  const normalizedChannel = channel.trim();
  if (!normalizedChannel.toLowerCase().startsWith(ROOM_CHANNEL_PREFIX)) {
    return null;
  }

  const channelBody = normalizedChannel.slice(ROOM_CHANNEL_PREFIX.length).trim();
  if (!channelBody) {
    return null;
  }

  const slashIndex = channelBody.indexOf("/");
  if (slashIndex < 0) {
    return {
      roomName: channelBody.toUpperCase(),
    };
  }

  const shard = normalizeShardValue(channelBody.slice(0, slashIndex));
  const roomName = channelBody.slice(slashIndex + 1).trim().toUpperCase();
  if (!roomName) {
    return null;
  }

  return {
    roomName,
    shard,
  };
}

function matchesTargetRoomChannel(
  channel: string,
  roomName: string,
  shard?: string
): boolean {
  const parsed = parseRoomRealtimeChannel(channel);
  if (!parsed) {
    return false;
  }
  if (parsed.roomName !== roomName) {
    return false;
  }
  if (!shard || !parsed.shard) {
    return true;
  }
  return parsed.shard === shard;
}

export function RoomDetailPanel({ roomName, roomShard }: RoomDetailPanelProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const lastRealtimeMutateAt = useRef(0);

  const normalizedName = useMemo(() => roomName.trim().toUpperCase(), [roomName]);
  const normalizedShard = useMemo(() => normalizeShardValue(roomShard), [roomShard]);
  const [roomInput, setRoomInput] = useState(normalizedName);
  const [shardInput, setShardInput] = useState(normalizedShard ?? "");
  const [liveSnapshot, setLiveSnapshot] = useState<RoomDetailSnapshot | undefined>(undefined);
  const liveSnapshotRef = useRef<RoomDetailSnapshot | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<RoomIntelTab | "map" | "manage">("map");
  const { shards: serverShards } = useServerShards(session);

  const swrKey =
    session && normalizedName
      ? ["room-detail", session.baseUrl, session.token, normalizedName, normalizedShard ?? ""]
      : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    () => {
      if (!session) {
        throw new Error("Session unavailable.");
      }
      return fetchRoomDetailSnapshot(session, normalizedName, normalizedShard, { requireObjects: Boolean(session.token.trim()) });
    },
    {
      refreshInterval: normalizedName ? 30_000 : 0,
      dedupingInterval: 2_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  const realtimeChannels = useMemo(
    () => buildRoomRealtimeChannels(normalizedName, normalizedShard, serverShards),
    [normalizedName, normalizedShard, serverShards]
  );

  useEffect(() => {
    setLiveSnapshot(undefined);
    liveSnapshotRef.current = undefined;
    lastRealtimeMutateAt.current = 0;
  }, [normalizedName, normalizedShard, session?.baseUrl, session?.token]);

  useEffect(() => {
    if (!data) {
      return;
    }
    setLiveSnapshot(data);
    liveSnapshotRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!session || !normalizedName || realtimeChannels.length === 0) {
      return;
    }

    const realtimeClient = new ScreepsRealtimeClient({
      baseUrl: session.baseUrl,
      token: session.token,
      reconnect: true,
      reconnectBaseMs: 1_200,
      reconnectMaxMs: 20_000,
    });

    const handleRealtime = (event: { channel: string; payload: unknown }) => {
      if (!matchesTargetRoomChannel(event.channel, normalizedName, normalizedShard)) {
        return;
      }

      const base = liveSnapshotRef.current;
      if (base) {
        const merged = mergeRoomDetailEvent(base, event.payload);
        if (merged) {
          liveSnapshotRef.current = merged;
          setLiveSnapshot(merged);
          return;
        }
      }

      const now = Date.now();
      if (now - lastRealtimeMutateAt.current < 5_000) {
        return;
      }
      lastRealtimeMutateAt.current = now;
      void mutate();
    };

    const unsubs = realtimeChannels.map((channel) =>
      realtimeClient.subscribe(channel, handleRealtime)
    );

    realtimeClient.connect();
    return () => {
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      realtimeClient.disconnect();
    };
  }, [mutate, normalizedName, normalizedShard, realtimeChannels, session]);

  const snapshot = liveSnapshot ?? data;
  const roomObjects = snapshot?.objects ?? [];
  const roomLabel = snapshot?.roomName ?? normalizedName;
  const shardLabel = snapshot?.shard ?? normalizedShard;
  const hasMap = Boolean(session && snapshot);

  useEffect(() => {
    setRoomInput(roomLabel ?? "");
  }, [roomLabel]);

  useEffect(() => {
    setShardInput(shardLabel ?? "");
  }, [shardLabel]);

  const navigateToRoom = useCallback(() => {
      const nextRoomName = roomInput.trim().toUpperCase();
      if (!/^[WE]\d+[NS]\d+$/.test(nextRoomName)) {
        return false;
      }

      const nextShard = shardInput.trim().toLowerCase();
      const searchParams = new URLSearchParams({
        name: nextRoomName,
      });
      if (nextShard) {
        searchParams.set("shard", nextShard);
      }

      const currentShard = roomShard?.trim().toLowerCase() ?? "";
      if (nextRoomName === normalizedName && nextShard === currentShard) {
        return false;
      }

      navigate(`/rooms?${searchParams.toString()}`);
      return true;
    },
    [navigate, normalizedName, roomInput, roomShard, shardInput]
  );

  const handleNavigateRoom = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToRoom();
    },
    [navigateToRoom]
  );

  const handleNavInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      navigateToRoom();
    },
    [navigateToRoom]
  );

  return (
    <section
      className={`panel dashboard-panel room-detail-panel${
        hasMap ? " room-detail-panel-map" : ""
      }`}
    >
      <header className="dashboard-header">
        <Link className="ghost-button" to="/rooms">← {t("intel.back")}</Link>
        <form className="room-detail-nav-form" onSubmit={handleNavigateRoom}>
          <input
            className="room-detail-nav-input"
            value={roomInput}
            onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
            onKeyDown={handleNavInputKeyDown}
            placeholder={t("rooms.searchLabel")}
            aria-label={t("rooms.searchLabel")}
            autoComplete="off"
            spellCheck={false}
          />
          <input
            className="room-detail-nav-input room-detail-nav-input-shard"
            value={shardInput}
            onChange={(event) => setShardInput(event.target.value.toLowerCase())}
            onKeyDown={handleNavInputKeyDown}
            placeholder="shard"
            aria-label="shard"
            autoComplete="off"
            spellCheck={false}
            list="room-detail-shard-options"
          />
          <datalist id="room-detail-shard-options">
            {serverShards.map((shard) => (
              <option key={shard} value={shard} />
            ))}
          </datalist>
          <button className="secondary-button room-detail-nav-button" type="submit">
            {t("rooms.openDetail")}
          </button>
        </form>
        <button className="ghost-button" type="button" disabled={isValidating} onClick={() => void mutate()}>{t("common.refreshNow")}</button>
      </header>

      {!session ? (
        <article className="card">
          <p className="hint-text">{t("rooms.loginToOpenDetail")}</p>
          <div className="inline-actions">
            <Link className="secondary-button" to="/login">
              {t("nav.loginLabel")}
            </Link>
          </div>
        </article>
      ) : null}

      {error ? (
        <p className="error-text">
          {error instanceof Error ? error.message : t("common.unknownError")}
        </p>
      ) : null}

      {isLoading && !data ? (
        <div className="section-stack">
          <div className="skeleton-line" style={{ height: 120 }} />
          <div className="skeleton-line" style={{ height: 220 }} />
        </div>
      ) : null}

      {session && snapshot ? (
        <>
          <div className="room-detail-meta"><strong>{roomLabel}</strong><span>{shardLabel ?? t("map.shardDefault")}</span><span>RCL {snapshot.controllerLevel ?? "—"}</span><span>{snapshot.owner ?? "—"}</span><span>{t("common.lastFetch")}: {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>{snapshot.gameTime !== undefined ? <span>Tick {snapshot.gameTime.toLocaleString()}</span> : null}</div>
          <div className="room-intel-tabs" role="tablist" aria-label={t("rooms.detailTitle")}>
            <button role="tab" aria-selected={activeTab === "map"} onClick={() => setActiveTab("map")}>{t("intel.detailMap")}</button>
            {(["overview", "resources", "buildings", "units", "manage"] as const).map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{t(`intel.tab.${tab}`)}</button>)}
          </div>
          {activeTab === "map" ? <div className="room-detail-map-wrap">
            <RoomGameplayMap
              encoded={snapshot.terrainEncoded}
              roomName={roomLabel}
              roomShard={shardLabel}
              gameTime={snapshot.gameTime}
              roomObjects={roomObjects}
              officialObjects={snapshot.officialObjects}
              officialUsers={snapshot.officialUsers}
              currentUsername={session.username}
              currentUserId={session.userId}
            />
          </div> : <div className="room-detail-data-panel" role="tabpanel">
            {activeTab === "manage" ? <RoomOperations session={session} snapshots={error || isValidating ? [] : [snapshot]} onComplete={() => void mutate()} /> : <RoomIntelligence key={activeTab} entries={[{ snapshot, stale: Boolean(error) }]} tab={activeTab} player={session} />}
          </div>}
        </>
      ) : null}
    </section>
  );
}
