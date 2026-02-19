"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchPublicSnapshot } from "../lib/screeps/public";
import type { PublicRoomStat } from "../lib/screeps/types";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";
import { MetricCell } from "./metric-cell";
import { TerrainThumbnail } from "./terrain-thumbnail";

const DEFAULT_SERVER_URL = "https://screeps.com";
const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/;

type RoomSortKey = "room" | "owner" | "level";
type OwnerFilter = "all" | "owned" | "unowned";
type NoviceFilter = "all" | "novice" | "normal";

function sortRooms(rooms: PublicRoomStat[], sortKey: RoomSortKey, desc: boolean): PublicRoomStat[] {
  const sorted = [...rooms];
  sorted.sort((left, right) => {
    if (sortKey === "level") {
      return (left.level ?? -1) - (right.level ?? -1);
    }

    if (sortKey === "owner") {
      const leftOwner = left.owner ?? "";
      const rightOwner = right.owner ?? "";
      return leftOwner.localeCompare(rightOwner);
    }

    return left.room.localeCompare(right.room);
  });

  return desc ? sorted.reverse() : sorted;
}

function formatMetric(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return "N/A";
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

export function PublicRoomsPanel() {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const activeBaseUrl = useMemo(
    () => normalizeBaseUrl(session?.baseUrl ?? DEFAULT_SERVER_URL),
    [session?.baseUrl]
  );
  const [roomInput, setRoomInput] = useState("");
  const [roomSortKey, setRoomSortKey] = useState<RoomSortKey>("level");
  const [sortDesc, setSortDesc] = useState(true);
  const [mapFilterKeyword, setMapFilterKeyword] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [noviceFilter, setNoviceFilter] = useState<NoviceFilter>("all");

  const { data, error, isLoading, mutate } = useSWR(
    ["public-rooms", activeBaseUrl],
    () => fetchPublicSnapshot(activeBaseUrl),
    {
      refreshInterval: 120_000,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const normalizedRoom = roomInput.trim().toUpperCase();
  const isValidRoom = ROOM_NAME_PATTERN.test(normalizedRoom);

  const roomStats = data?.map?.roomStats ?? [];
  const visibleRooms = useMemo(() => {
    const keyword = mapFilterKeyword.trim().toLowerCase();
    const filtered = roomStats.filter((room) => {
      if (ownerFilter === "owned" && !room.owner) {
        return false;
      }
      if (ownerFilter === "unowned" && room.owner) {
        return false;
      }

      if (noviceFilter === "novice" && room.novice !== true) {
        return false;
      }
      if (noviceFilter === "normal" && room.novice !== false) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return (
        room.room.toLowerCase().includes(keyword) ||
        (room.owner ?? "").toLowerCase().includes(keyword)
      );
    });

    return sortRooms(filtered, roomSortKey, sortDesc);
  }, [mapFilterKeyword, noviceFilter, ownerFilter, roomSortKey, roomStats, sortDesc]);
  const leaderboardEntries = data?.leaderboard?.entries ?? [];
  const featuredMetric = data?.leaderboard?.dimensions.find((item) => item !== "score");

  const ownedCount = roomStats.filter((room) => Boolean(room.owner)).length;
  const levelSum = roomStats.reduce((sum, room) => sum + (room.level ?? 0), 0);
  const levelCount = roomStats.filter((room) => room.level !== undefined).length;
  const averageLevel = levelCount ? levelSum / levelCount : undefined;

  return (
    <section className="panel dashboard-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{t("rooms.title")}</h1>
          <p className="page-subtitle">
            {session ? t("rooms.subtitleAuth") : t("rooms.subtitleGuest")}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/rankings">
            {t("rooms.openRankings")}
          </Link>
          <button className="secondary-button" onClick={() => void mutate()}>
            {t("common.refreshNow")}
          </button>
        </div>
      </header>

      <article className="card room-search-card">
        <h2>{t("rooms.searchTitle")}</h2>
        <div className="inline-actions">
          <label className="field compact-field">
            <span>{t("rooms.searchLabel")}</span>
            <input
              value={roomInput}
              onChange={(event) => setRoomInput(event.currentTarget.value)}
              placeholder="W8N3"
            />
          </label>
          {session && isValidRoom ? (
            <Link className="secondary-button" href={`/user/room?name=${encodeURIComponent(normalizedRoom)}`}>
              {t("rooms.openDetail")}
            </Link>
          ) : (
            <span className="hint-text">
              {session ? t("rooms.searchHint") : t("rooms.loginToOpenDetail")}
            </span>
          )}
        </div>
      </article>

      {error && !data ? (
        <p className="error-text">
          {error instanceof Error ? error.message : t("common.unknownError")}
        </p>
      ) : null}

      {isLoading && !data ? (
        <div className="section-stack">
          <div className="skeleton-line" style={{ height: 90 }} />
          <div className="skeleton-line" style={{ height: 240 }} />
        </div>
      ) : null}

      {data ? (
        <div className="section-stack">
          <article className="card">
            <h2>{t("rooms.mapStats")}</h2>
            <div className="metric-cluster">
              <MetricCell label={t("dashboard.rooms")} value={String(visibleRooms.length)} align="right" />
              <MetricCell label={t("dashboard.owner")} value={String(ownedCount)} align="right" />
              <MetricCell
                label={t("rooms.level")}
                value={averageLevel === undefined ? "N/A" : averageLevel.toFixed(2)}
                align="right"
              />
              <MetricCell
                label={t("rooms.terrainRoom")}
                value={data.map?.terrainRoom ?? "N/A"}
                align="right"
              />
            </div>
          </article>

          <div className="card-grid">
            <article className="card">
              <h2>{t("rooms.room")}</h2>
              <div className="control-row">
                <label className="field compact-field">
                  <span>Filter</span>
                  <input
                    value={mapFilterKeyword}
                    onChange={(event) => setMapFilterKeyword(event.currentTarget.value)}
                    placeholder="W8N3 / owner"
                  />
                </label>

                <label className="field">
                  <span>Sort</span>
                  <select
                    className="compact-select"
                    value={roomSortKey}
                    onChange={(event) => setRoomSortKey(event.currentTarget.value as RoomSortKey)}
                  >
                    <option value="level">{t("rooms.level")}</option>
                    <option value="owner">{t("dashboard.owner")}</option>
                    <option value="room">{t("rooms.room")}</option>
                  </select>
                </label>

                <label className="field">
                  <span>Owner</span>
                  <select
                    className="compact-select"
                    value={ownerFilter}
                    onChange={(event) => setOwnerFilter(event.currentTarget.value as OwnerFilter)}
                  >
                    <option value="all">All</option>
                    <option value="owned">Owned</option>
                    <option value="unowned">Unowned</option>
                  </select>
                </label>

                <label className="field">
                  <span>{t("rooms.novice")}</span>
                  <select
                    className="compact-select"
                    value={noviceFilter}
                    onChange={(event) => setNoviceFilter(event.currentTarget.value as NoviceFilter)}
                  >
                    <option value="all">All</option>
                    <option value="novice">{t("rooms.true")}</option>
                    <option value="normal">{t("rooms.false")}</option>
                  </select>
                </label>

                <button
                  className="secondary-button"
                  onClick={() => setSortDesc((current) => !current)}
                  type="button"
                >
                  {sortDesc ? "DESC" : "ASC"}
                </button>
              </div>

              {visibleRooms.length ? (
                <div className="dense-table-wrap">
                  <table className="dense-table">
                    <thead>
                      <tr>
                        <th>{t("rooms.room")}</th>
                        <th>{t("dashboard.owner")}</th>
                        <th className="numeric">{t("rooms.level")}</th>
                        <th>{t("rooms.novice")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRooms.map((room) => (
                        <tr key={room.room}>
                          <td>
                            {session ? (
                              <Link className="table-link" href={`/user/room?name=${encodeURIComponent(room.room)}`}>
                                {room.room}
                              </Link>
                            ) : (
                              room.room
                            )}
                          </td>
                          <td>{room.owner ?? t("common.notAvailable")}</td>
                          <td className="numeric">{room.level ?? "N/A"}</td>
                          <td>
                            {room.novice === undefined
                              ? t("common.notAvailable")
                              : room.novice
                                ? t("rooms.true")
                                : t("rooms.false")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint-text">{t("rooms.mapStatsEmpty")}</p>
              )}
            </article>

            <article className="card">
              <h2>{t("rooms.leaderboard")}</h2>
              <TerrainThumbnail
                encoded={data.map?.encodedTerrain}
                roomName={data.map?.terrainRoom ?? "W0N0"}
                size={148}
              />

              {leaderboardEntries.length ? (
                <div className="dense-table-wrap">
                  <table className="dense-table">
                    <thead>
                      <tr>
                        <th className="numeric">{t("rooms.rank")}</th>
                        <th>{t("rooms.player")}</th>
                        <th className="numeric">{t("rooms.score")}</th>
                        {featuredMetric ? <th className="numeric">{featuredMetric}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardEntries.map((entry) => (
                        <tr key={`${entry.username}-${entry.rank ?? "na"}`}>
                          <td className="numeric">{entry.rank ?? "N/A"}</td>
                          <td>{entry.username}</td>
                          <td className="numeric">{formatMetric(entry.score)}</td>
                          {featuredMetric ? (
                            <td className="numeric">{formatMetric(entry.metrics[featuredMetric])}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint-text">{t("rooms.leaderboardEmpty")}</p>
              )}
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
