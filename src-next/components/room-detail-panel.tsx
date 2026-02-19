"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchRoomDetailSnapshot } from "../lib/screeps/room-detail";
import { useAuthStore } from "../stores/auth-store";
import { MetricCell } from "./metric-cell";
import { TerrainThumbnail } from "./terrain-thumbnail";

interface RoomDetailPanelProps {
  roomName: string;
}

interface StructureGroup {
  type: string;
  count: number;
  avgHitsPercent?: number;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) {
    return "N/A";
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function formatCoordinate(x: number, y: number): string {
  return `(${x}, ${y})`;
}

function summarizeStructures(
  structures: { type: string; hits?: number; hitsMax?: number }[]
): StructureGroup[] {
  const bucket = new Map<string, { count: number; ratioTotal: number; ratioCount: number }>();

  for (const item of structures) {
    const current = bucket.get(item.type) ?? { count: 0, ratioTotal: 0, ratioCount: 0 };
    current.count += 1;

    if (item.hits !== undefined && item.hitsMax !== undefined && item.hitsMax > 0) {
      current.ratioTotal += (item.hits / item.hitsMax) * 100;
      current.ratioCount += 1;
    }

    bucket.set(item.type, current);
  }

  return [...bucket.entries()]
    .map(([type, value]) => ({
      type,
      count: value.count,
      avgHitsPercent:
        value.ratioCount > 0 ? Number((value.ratioTotal / value.ratioCount).toFixed(2)) : undefined,
    }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

export function RoomDetailPanel({ roomName }: RoomDetailPanelProps) {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const [structureFilter, setStructureFilter] = useState("");
  const [creepFilter, setCreepFilter] = useState("");

  const normalizedName = useMemo(() => roomName.trim().toUpperCase(), [roomName]);

  if (!normalizedName) {
    return (
      <section className="panel dashboard-panel">
        <h1 className="page-title">{t("rooms.detailTitle")}</h1>
        <p className="hint-text">{t("rooms.searchHint")}</p>
      </section>
    );
  }

  if (!session) {
    return null;
  }

  const { data, error, isLoading, mutate } = useSWR(
    ["room-detail", session.baseUrl, session.token, normalizedName],
    () => fetchRoomDetailSnapshot(session, normalizedName),
    {
      revalidateOnFocus: false,
      dedupingInterval: 8_000,
    }
  );

  const structureGroups = summarizeStructures(data?.structures ?? []);
  const creeps = [...(data?.creeps ?? [])].sort(
    (left, right) => (right.ttl ?? -1) - (left.ttl ?? -1)
  );
  const normalizedStructureFilter = structureFilter.trim().toLowerCase();
  const normalizedCreepFilter = creepFilter.trim().toLowerCase();
  const visibleStructureGroups = structureGroups.filter((item) =>
    normalizedStructureFilter ? item.type.toLowerCase().includes(normalizedStructureFilter) : true
  );
  const visibleCreeps = creeps.filter((item) => {
    if (!normalizedCreepFilter) {
      return true;
    }

    return (
      item.name.toLowerCase().includes(normalizedCreepFilter) ||
      (item.role ?? "").toLowerCase().includes(normalizedCreepFilter)
    );
  });

  return (
    <section className="panel dashboard-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">
            {t("rooms.detailTitle")}: {normalizedName}
          </h1>
          <p className="page-subtitle">{t("rooms.detailSubtitle")}</p>
        </div>

        <div className="header-actions">
          <Link className="ghost-button" href="/rooms">
            {t("rooms.title")}
          </Link>
          <button className="secondary-button" onClick={() => void mutate()}>
            {t("common.refreshNow")}
          </button>
        </div>
      </header>

      {error && !data ? (
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

      {data ? (
        <div className="section-stack">
          <article className="card">
            <h2>{t("rooms.detailSummary")}</h2>
            <div className="metric-cluster">
              <MetricCell label={t("dashboard.owner")} value={data.owner ?? "N/A"} />
              <MetricCell
                label={t("dashboard.rcl")}
                value={formatNumber(data.controllerLevel)}
                align="right"
              />
              <MetricCell
                label={t("dashboard.energy")}
                value={`${formatNumber(data.energyAvailable)} / ${formatNumber(data.energyCapacity)}`}
                align="right"
              />
              <MetricCell label={t("rooms.sources")} value={String(data.sources.length)} align="right" />
              <MetricCell label="Minerals" value={String(data.minerals.length)} align="right" />
              <MetricCell label={t("rooms.structures")} value={String(data.structures.length)} align="right" />
              <MetricCell label={t("rooms.creeps")} value={String(data.creeps.length)} align="right" />
            </div>
          </article>

          <div className="card-grid">
            <article className="card">
              <h2>{t("rooms.terrain")}</h2>
              <div className="room-detail-terrain">
                <TerrainThumbnail encoded={data.terrainEncoded} roomName={normalizedName} size={220} />
              </div>
              <div className="inline-actions">
                {data.sources.map((source) => (
                  <span className="entity-chip" key={`src-${source.x}-${source.y}`}>
                    S {formatCoordinate(source.x, source.y)}
                  </span>
                ))}
                {data.minerals.map((mineral) => (
                  <span className="entity-chip" key={`min-${mineral.x}-${mineral.y}`}>
                    {mineral.type ?? "M"} {formatCoordinate(mineral.x, mineral.y)}
                  </span>
                ))}
              </div>
            </article>

            <article className="card">
              <h2>{t("rooms.structures")}</h2>
              <div className="control-row">
                <label className="field compact-field">
                  <span>Filter</span>
                  <input
                    value={structureFilter}
                    onChange={(event) => setStructureFilter(event.currentTarget.value)}
                    placeholder="spawn / extension / tower"
                  />
                </label>
                <span className="entity-chip">Visible {visibleStructureGroups.length}</span>
              </div>
              {visibleStructureGroups.length ? (
                <div className="dense-table-wrap">
                  <table className="dense-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th className="numeric">Count</th>
                        <th className="numeric">Avg HP%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStructureGroups.map((item) => (
                        <tr key={item.type}>
                          <td>{item.type}</td>
                          <td className="numeric">{item.count}</td>
                          <td className="numeric">
                            {item.avgHitsPercent === undefined ? "N/A" : `${item.avgHitsPercent.toFixed(2)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint-text">{t("rooms.detailEmpty")}</p>
              )}
            </article>
          </div>

          <article className="card">
            <h2>{t("rooms.creeps")}</h2>
            <div className="control-row">
              <label className="field compact-field">
                <span>Filter</span>
                <input
                  value={creepFilter}
                  onChange={(event) => setCreepFilter(event.currentTarget.value)}
                  placeholder="name / role"
                />
              </label>
              <span className="entity-chip">Visible {visibleCreeps.length}</span>
            </div>
            {visibleCreeps.length ? (
              <div className="dense-table-wrap">
                <table className="dense-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Position</th>
                      <th className="numeric">TTL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCreeps.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td>{item.role ?? "N/A"}</td>
                        <td>{formatCoordinate(item.x, item.y)}</td>
                        <td className="numeric">{item.ttl ?? "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint-text">{t("rooms.detailEmpty")}</p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
