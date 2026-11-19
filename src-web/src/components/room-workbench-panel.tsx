import { Link } from "react-router-dom";
import { useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchRoomDirectory, toDashboardRoomKey } from "../lib/screeps/dashboard";
import { summarizeRoomObjects } from "../lib/screeps/room-insights";
import { useRoomWorkspace } from "../lib/screeps/use-room-workspace";
import type { RoomSummary, RoomDetailSnapshot } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";
import { useRoomWorkspaceStore } from "../stores/room-workspace-store";
import { TerrainThumbnail } from "./terrain-thumbnail";
import { RoomIntelligence, type RoomIntelTab } from "./room-intelligence";
import { RoomOperations } from "./room-operations";

const EMPTY_ROOMS: RoomSummary[] = [];
const roomKey = (room: RoomSummary) => toDashboardRoomKey(room.name, room.shard);
const count = (value?: number) => value === undefined ? "—" : value.toLocaleString();
function roomDetailUrl(room: RoomSummary) {
  const params = new URLSearchParams({ name: room.name });
  if (room.shard) params.set("shard", room.shard);
  return `/rooms?${params.toString()}`;
}

export function RoomWorkbenchPanel() {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);
  const [filter, setFilter] = useState("");
  const [shardFilter, setShardFilter] = useState("");
  const [sort, setSort] = useState("name");
  const [selectedKeys, setSelectedKeys] = useState<string[] | null>(null);
  const [tab, setTab] = useState<RoomIntelTab | "manage">("overview");
  const [addRoom, setAddRoom] = useState("");
  const [addShard, setAddShard] = useState("");
  const [refreshPaused, setRefreshPaused] = useState(false);
  const scope = session ? `${session.baseUrl.toLowerCase()}|${session.username.toLowerCase()}` : "";
  const watched = useRoomWorkspaceStore((state) => state.watched[scope]) ?? EMPTY_ROOMS;
  const toggleWatch = useRoomWorkspaceStore((state) => state.toggle);
  const { data: directory = EMPTY_ROOMS, error, isLoading, isValidating, mutate } = useSWR(
    session?.token ? ["room-directory", session.baseUrl, session.username, session.token] : null,
    () => fetchRoomDirectory(session!),
    { refreshInterval: refreshPaused ? 0 : Math.max(60_000, refreshIntervalMs), revalidateOnFocus: false, dedupingInterval: 10_000 }
  );
  const rooms = useMemo(() => {
    const merged = new Map<string, RoomSummary>();
    for (const room of [...watched, ...directory]) merged.set(roomKey(room), room);
    return [...merged.values()].sort((a, b) => (a.shard ?? "").localeCompare(b.shard ?? "") || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [directory, watched]);
  const { entries, refresh, loading } = useRoomWorkspace(session, rooms, refreshPaused ? 0 : refreshIntervalMs);
  const rows = useMemo(() => rooms.map((room) => {
    const entry = entries[roomKey(room)];
    const insight = summarizeRoomObjects(entry?.snapshot?.objects ?? [], session ?? undefined, entry?.snapshot?.gameTime);
    return { room, entry, insight };
  }), [entries, rooms, session]);
  const selection = new Set(selectedKeys ?? rooms.slice(0, 4).map(roomKey));
  const selectedRows = rows.filter(({ room }) => selection.has(roomKey(room)));
  const filteredRows = rows.filter(({ room }) => (!shardFilter || room.shard === shardFilter) &&
    `${room.name} ${room.shard ?? ""} ${room.owner ?? ""}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => {
      if (sort === "energy") {
        const freshEnergy = (row: (typeof rows)[number]) =>
          row.entry?.error ? 0 : row.insight.storedEnergy;
        return freshEnergy(b) - freshEnergy(a);
      }
      if (sort === "attention") {
        const score = (row: (typeof rows)[number]) =>
          Number(Boolean(row.entry?.error)) + (row.entry?.error ? 0 : row.insight.alerts.length);
        return score(b) - score(a);
      }
      return a.room.name.localeCompare(b.room.name, undefined, { numeric: true }) || (a.room.shard ?? "").localeCompare(b.room.shard ?? "");
    });
  const shards = [...new Set(rooms.map((room) => room.shard).filter((shard): shard is string => Boolean(shard)))];
  const intelEntries = selectedRows.flatMap(({ entry }) => entry?.snapshot ? [{ snapshot: entry.snapshot, stale: Boolean(entry.error) }] : []);
  const snapshots: RoomDetailSnapshot[] = selectedRows.flatMap(({ entry }) => entry?.snapshot && !entry.error && !entry.loading ? [entry.snapshot] : []);
  const freshSelectedRows = selectedRows.filter(({ entry }) => entry?.snapshot && !entry.error);
  const readyCount = rows.filter(({ entry }) => entry?.snapshot && !entry.error).length;
  const staleCount = rows.filter(({ entry }) => entry?.snapshot && entry.error).length;
  const errors = rows.filter(({ entry }) => entry?.error);
  const alertCount = freshSelectedRows.reduce((sum, { insight }) => sum + insight.alerts.length, 0);
  const freshStoredEnergy = freshSelectedRows.reduce((sum, { insight }) => sum + insight.storedEnergy, 0);
  const freshBuildingCount = freshSelectedRows.reduce((sum, row) => sum + row.insight.buildingCount, 0);
  const freshCreepCount = freshSelectedRows.reduce((sum, row) => sum + row.insight.creepCount, 0);

  function toggleRoom(room: RoomSummary) {
    const key = roomKey(room);
    setSelectedKeys((current) => {
      const values = current ?? rooms.slice(0, 4).map(roomKey);
      return values.includes(key) ? values.filter((item) => item !== key) : [...values, key];
    });
  }

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!session || !/^[WE]\d+[NS]\d+$/i.test(addRoom.trim())) return;
    const room = { name: addRoom.trim().toUpperCase(), ...(addShard.trim() ? { shard: addShard.trim().toLowerCase() } : {}) };
    if (!watched.some((item) => roomKey(item) === roomKey(room))) toggleWatch(scope, room);
    setSelectedKeys([...new Set([...selection, roomKey(room)])]);
    setAddRoom("");
  }

  async function refreshAll() {
    await Promise.allSettled([mutate(), refresh()]);
  }

  if (!session) return <section className="panel dashboard-panel room-workbench-panel"><header className="room-workbench-header"><p className="room-eyebrow">SCREEPS / CONTROL CENTER</p><h1 className="page-title">{t("rooms.workspaceTitle")}</h1><p className="room-lead">{t("rooms.workspaceSubtitle")}</p></header><article className="card room-empty-state"><h2>{t("intel.connectTitle")}</h2><p>{t("rooms.loginToOpenDetail")}</p><Link className="secondary-button" to="/login">{t("nav.loginLabel")}</Link><Link className="ghost-button" to="/map">{t("map.title")}</Link></article></section>;

  return (
    <section className="panel dashboard-panel room-workbench-panel">
      <header className="dashboard-header room-workbench-header">
        <div><p className="room-eyebrow">SCREEPS / CONTROL CENTER</p><h1 className="page-title">{t("rooms.workspaceTitle")}</h1><p className="room-lead">{t("rooms.workspaceSubtitle")}</p></div>
        <div className="room-workbench-header-actions"><span className={`room-sync-badge${loading || isValidating ? " is-syncing" : ""}`}><i />{loading || isValidating ? t("common.syncing") : refreshPaused ? t("intel.paused") : t("intel.autoRefresh", { seconds: Math.round(refreshIntervalMs / 1_000) })}</span><button className="ghost-button" onClick={() => setRefreshPaused((value) => !value)}>{t(refreshPaused ? "intel.resume" : "intel.pause")}</button><button className="secondary-button" onClick={() => void refreshAll()} disabled={isLoading || loading}>{t("rooms.refreshAll")}</button></div>
      </header>
      <div className="room-empire-metrics">
        <div><span>{t("intel.connectedRooms")}</span><strong>{readyCount}<small> / {rooms.length}</small></strong><small>{shards.length} {t("map.shard")} · {staleCount} {t("intel.staleShort")}</small></div>
        <div><span>{t("intel.stockEnergy")}</span><strong>{freshSelectedRows.length ? count(freshStoredEnergy) : "—"}</strong><small>{t("rooms.selectedCount", { count: selectedRows.length })}</small></div>
        <div><span>{t("rooms.buildingCount")} / {t("rooms.creepCount")}</span><strong>{freshBuildingCount}<small> / {freshCreepCount}</small></strong><small>{t("intel.loadedOnly")}</small></div>
        <div className={alertCount || errors.length ? "has-warning" : ""}><span>{t("intel.attention")}</span><strong>{alertCount}<small> / {errors.length} {t("intel.failed")}</small></strong><small>{t("intel.alertHint")}</small></div>
      </div>
      {error ? <div className="room-request-error" role="alert"><strong>{t("rooms.workspaceError")}</strong><span>{error instanceof Error ? error.message : t("common.unknownError")}</span><button className="ghost-button" onClick={() => void mutate()}>{t("common.refreshNow")}</button></div> : null}
      {!session.token ? <p className="hint-text">{t("intel.guestHint")}</p> : null}

      <div className="room-workbench-toolbar">
        <label className="field room-filter-field"><span>{t("intel.filterRooms")}</span><input value={filter} onChange={(event) => setFilter(event.currentTarget.value)} placeholder="W8N3 / shard0" /></label>
        <label className="field"><span>{t("map.shard")}</span><select value={shardFilter} onChange={(event) => setShardFilter(event.currentTarget.value)}><option value="">{t("resources.shardAll")}</option>{shards.map((shard) => <option key={shard}>{shard}</option>)}</select></label>
        <label className="field"><span>{t("intel.sort")}</span><select value={sort} onChange={(event) => setSort(event.currentTarget.value)}><option value="name">{t("rooms.searchLabel")}</option><option value="energy">{t("intel.stockEnergy")}</option><option value="attention">{t("intel.attention")}</option></select></label>
        <div className="room-selection-actions"><button className="ghost-button" onClick={() => setSelectedKeys([...new Set([...selection, ...filteredRows.map(({ room }) => roomKey(room))])])} disabled={!filteredRows.length}>{t("rooms.selectAll")}</button><button className="ghost-button" onClick={() => setSelectedKeys([])} disabled={!selectedRows.length}>{t("rooms.clearSelection")}</button></div>
      </div>
      <form className="room-watch-form" onSubmit={handleAdd}>
        <span>{t("intel.watchRoom")}</span><input aria-label={t("rooms.searchLabel")} placeholder="W8N3" pattern="[WwEe][0-9]+[NnSs][0-9]+" required value={addRoom} onChange={(event) => setAddRoom(event.currentTarget.value.toUpperCase())} /><input aria-label={t("map.shard")} placeholder={t("map.shardDefault")} pattern="[a-zA-Z0-9_-]{1,64}" value={addShard} onChange={(event) => setAddShard(event.currentTarget.value)} list="workspace-shards" /><datalist id="workspace-shards">{shards.map((shard) => <option key={shard}>{shard}</option>)}</datalist><button className="ghost-button">{t("intel.addWatch")}</button>
      </form>

      {isLoading && !rooms.length ? <div className="room-workbench-room-list" aria-label={t("rooms.loading")}>{[0, 1, 2].map((index) => <div className="skeleton-line" key={index} style={{ height: 250 }} />)}</div> : null}
      {!rooms.length && !isLoading ? <div className="room-empty-state"><h2>{t("intel.noRoomsTitle")}</h2><p>{t("rooms.noRoomsForWorkspace")}</p></div> : null}
      {!filteredRows.length && rooms.length ? <p className="room-empty-state">{t("intel.noMatches")}</p> : null}
      <div className="room-workbench-room-list">
        {filteredRows.map(({ room, insight, entry }) => {
          const key = roomKey(room);
          const snapshot = entry?.snapshot;
          const isWatched = watched.some((item) => roomKey(item) === key);
          const hasFreshSnapshot = Boolean(snapshot && !entry?.error);
          const controller = hasFreshSnapshot ? insight.controller : undefined;
          const energy = hasFreshSnapshot ? insight.energyAvailable ?? snapshot?.energyAvailable ?? room.energyAvailable : undefined;
          const capacity = hasFreshSnapshot ? insight.energyCapacity ?? snapshot?.energyCapacity ?? room.energyCapacity : undefined;
          return <article className={`room-workbench-card${selection.has(key) ? " is-selected" : ""}`} key={key}>
            <header className="room-workbench-card-head"><label className="room-workbench-select"><input type="checkbox" checked={selection.has(key)} onChange={() => toggleRoom(room)} aria-label={`${t("rooms.selectRoom")}: ${room.name} ${room.shard ?? ""}`} /><span className="room-workbench-check" aria-hidden="true" /><strong>{room.name}</strong></label><span className="entity-chip">RCL {hasFreshSnapshot ? controller?.level ?? snapshot?.controllerLevel ?? room.level ?? "—" : "—"}</span><button className={`room-watch-toggle${isWatched ? " is-active" : ""}`} title={t(isWatched ? "intel.unwatch" : "intel.watchRoom")} aria-label={t(isWatched ? "intel.unwatch" : "intel.watchRoom")} onClick={() => toggleWatch(scope, room)}>{isWatched ? "★" : "☆"}</button></header>
            <div className="room-card-body"><Link className="room-workbench-map-button" to={roomDetailUrl(room)} aria-label={`${t("rooms.openRoom")} ${room.name}`}><TerrainThumbnail encoded={snapshot?.terrainEncoded} roomName={room.name} size={200} roomObjects={snapshot?.objects} /></Link><div className="room-card-facts"><span className="room-card-shard">{room.shard ?? t("map.shardDefault")}</span><span>{entry?.error ? "—" : snapshot?.owner ?? room.owner ?? "—"}</span><span>{t("intel.stockEnergy")}<b>{hasFreshSnapshot ? count(insight.storedEnergy) : "—"}</b></span><span>{t("rooms.creepCount")}<b>{hasFreshSnapshot ? insight.creepCount : "—"}</b></span><span>{t("rooms.constructionSites")}<b>{hasFreshSnapshot ? insight.constructionSiteCount : "—"}</b></span></div></div>
            <div className={`room-workbench-energy${entry?.error ? " is-stale" : ""}`}><span>{t("intel.spawnEnergy")}</span><strong>{count(energy)} / {count(capacity)}</strong></div><div className={`room-mini-track is-energy${entry?.error ? " is-stale" : ""}`}><i style={{ width: `${capacity ? Math.min(100, (energy ?? 0) / capacity * 100) : 0}%` }} /></div>
            <div className="room-card-status"><span className={entry?.error ? "error-text" : ""}>{entry?.loading ? t("common.syncing") : entry?.error ? t(snapshot ? "intel.staleShort" : "intel.failed") : snapshot ? `${t("common.lastFetch")} ${new Date(snapshot.fetchedAt).toLocaleTimeString()}` : t("intel.waiting")}</span>{!entry?.error && insight.alerts.length ? <span className="room-warning-badge">{insight.alerts.length} {t("intel.attention")}</span> : null}</div>
            {entry?.error ? <details className="room-card-error"><summary>{t("intel.requestDetails")}</summary><p>{entry.error}</p><button className="ghost-button" disabled={entry.loading} onClick={() => void refresh([room])}>{t("common.refreshNow")}</button></details> : null}
            <footer><span>{hasFreshSnapshot ? insight.buildingCount : "—"} {t("rooms.buildingCount")}</span><Link to={roomDetailUrl(room)}>{t("rooms.openRoom")} <span aria-hidden="true">↗</span></Link></footer>
          </article>;
        })}
      </div>

      <section className="room-workspace-analysis">
        <div className="room-workspace-analysis-head"><div><h2>{t("rooms.compareTitle")}</h2><span>{t("rooms.selectedCount", { count: selectedRows.length })} · {intelEntries.length} {t("intel.loaded")}</span></div><button className="ghost-button" disabled={!selectedRows.length || loading} onClick={() => void refresh(selectedRows.map(({ room }) => room))}>{t("rooms.refreshSelected")}</button></div>
        <div className="room-intel-tabs" role="tablist" aria-label={t("rooms.compareTitle")}>{(["overview", "resources", "buildings", "units", "manage"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} id={`workspace-tab-${value}`} aria-controls="workspace-tab-content" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{t(`intel.tab.${value}`)}</button>)}</div>
        <div id="workspace-tab-content" role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
          {tab === "manage" ? <RoomOperations key={selectedRows.map(({ room }) => roomKey(room)).join("|")} session={session} snapshots={snapshots} onComplete={() => void refresh(selectedRows.map(({ room }) => room))} /> : selectedRows.length > 0 && intelEntries.length === 0 ? <p className="room-empty-state" role="status">{t(loading ? "rooms.detailLoading" : "rooms.roomObjectsUnavailable")}</p> : <RoomIntelligence key={tab} entries={intelEntries} tab={tab} player={session} />}
        </div>
      </section>
    </section>
  );
}
