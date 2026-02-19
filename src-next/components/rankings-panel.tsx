"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchRankingSnapshot } from "../lib/screeps/rankings";
import type { RankingMode } from "../lib/screeps/types";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";

const DEFAULT_SERVER_URL = "https://screeps.com";
const PAGE_SIZE = 20;

type SortMode = "rank" | "username" | "metric";

function formatMetric(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return "N/A";
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function trendClass(delta: number | undefined): string {
  if (delta === undefined) {
    return "trend-flat";
  }
  if (delta > 0) {
    return "trend-up";
  }
  if (delta < 0) {
    return "trend-down";
  }
  return "trend-flat";
}

function trendText(delta: number | undefined): string {
  if (delta === undefined || delta === 0) {
    return "-";
  }
  if (delta > 0) {
    return `+${delta}`;
  }
  return `-${Math.abs(delta)}`;
}

export function RankingsPanel() {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);

  const previousRanksRef = useRef<Map<string, number>>(new Map());
  const baseUrl = useMemo(
    () => normalizeBaseUrl(session?.baseUrl ?? DEFAULT_SERVER_URL),
    [session?.baseUrl]
  );
  const [mode, setMode] = useState<RankingMode>("global");
  const [season, setSeason] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [selectedDimension, setSelectedDimension] = useState<string>("score");
  const [sortMode, setSortMode] = useState<SortMode>("rank");
  const [sortDesc, setSortDesc] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  const [onlyCurrentUser, setOnlyCurrentUser] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    ["rankings", baseUrl, mode, season, page],
    () =>
      fetchRankingSnapshot(baseUrl, {
        mode,
        season,
        page,
        pageSize: PAGE_SIZE,
      }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 8_000,
    }
  );

  const dimensions = data?.dimensions ?? [];
  const visibleDimensions = useMemo(() => {
    if (!dimensions.length) {
      return [selectedDimension];
    }
    if (!dimensions.includes(selectedDimension)) {
      return dimensions;
    }
    return [selectedDimension, ...dimensions.filter((item) => item !== selectedDimension)];
  }, [dimensions, selectedDimension]);

  useEffect(() => {
    if (!dimensions.length) {
      return;
    }
    if (!dimensions.includes(selectedDimension)) {
      setSelectedDimension(dimensions[0]);
    }
  }, [dimensions, selectedDimension]);

  const trendMap = useMemo(() => {
    const output = new Map<string, number>();
    const previousRanks = previousRanksRef.current;

    for (const entry of data?.entries ?? []) {
      if (entry.rank === undefined) {
        continue;
      }
      const previous = previousRanks.get(entry.username);
      if (previous !== undefined) {
        output.set(entry.username, previous - entry.rank);
      }
    }

    return output;
  }, [data?.entries]);

  useEffect(() => {
    if (!data?.entries.length) {
      return;
    }

    const next = new Map<string, number>();
    for (const entry of data.entries) {
      if (entry.rank !== undefined) {
        next.set(entry.username, entry.rank);
      }
    }
    previousRanksRef.current = next;
  }, [data?.entries, data?.fetchedAt]);

  const sortedEntries = useMemo(() => {
    const entries = [...(data?.entries ?? [])];

    entries.sort((left, right) => {
      if (sortMode === "username") {
        return left.username.localeCompare(right.username);
      }

      if (sortMode === "metric") {
        const leftMetric = left.metrics[selectedDimension];
        const rightMetric = right.metrics[selectedDimension];
        const leftMissing = leftMetric === undefined || leftMetric === null;
        const rightMissing = rightMetric === undefined || rightMetric === null;

        if (leftMissing && rightMissing) {
          return 0;
        }
        if (leftMissing) {
          return -1;
        }
        if (rightMissing) {
          return 1;
        }

        return leftMetric - rightMetric;
      }

      const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });

    return sortDesc ? entries.reverse() : entries;
  }, [data?.entries, selectedDimension, sortDesc, sortMode]);

  const currentUser = session?.username.trim().toLowerCase();
  const currentUserEntry = currentUser
    ? sortedEntries.find((entry) => entry.username.toLowerCase() === currentUser)
    : undefined;

  const visibleEntries = useMemo(() => {
    const keyword = nameFilter.trim().toLowerCase();

    return sortedEntries.filter((entry) => {
      if (onlyCurrentUser && (!currentUser || entry.username.toLowerCase() !== currentUser)) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return entry.username.toLowerCase().includes(keyword);
    });
  }, [currentUser, nameFilter, onlyCurrentUser, sortedEntries]);

  const topMetric = visibleEntries.find(
    (entry) => entry.metrics[selectedDimension] !== undefined && entry.metrics[selectedDimension] !== null
  )?.metrics[selectedDimension];

  return (
    <section className="panel dashboard-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{t("rankings.title")}</h1>
          <p className="page-subtitle">{t("rankings.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => void mutate()}>
            {t("common.refreshNow")}
          </button>
        </div>
      </header>

      <div className="control-row">
        <label className="field compact-field">
          <span>{t("rankings.mode")}</span>
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.currentTarget.value as RankingMode);
              setPage(1);
            }}
          >
            <option value="global">{t("rankings.global")}</option>
            <option value="season">{t("rankings.season")}</option>
          </select>
        </label>

        {mode === "season" ? (
          <label className="field compact-field">
            <span>{t("rankings.season")}</span>
            <select
              value={season ?? data?.seasons[0] ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSeason(value || undefined);
                setPage(1);
              }}
            >
              {(data?.seasons ?? []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="field compact-field">
          <span>{t("rankings.dimension")}</span>
          <select
            value={selectedDimension}
            onChange={(event) => {
              setSelectedDimension(event.currentTarget.value);
              setSortMode("metric");
              setSortDesc(true);
            }}
          >
            {visibleDimensions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="field compact-field">
          <span>Sort</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.currentTarget.value as SortMode)}
          >
            <option value="rank">{t("rooms.rank")}</option>
            <option value="username">{t("rooms.player")}</option>
            <option value="metric">{t("rankings.dimension")}</option>
          </select>
        </label>

        <button
          className="secondary-button"
          onClick={() => setSortDesc((current) => !current)}
          type="button"
        >
          {sortDesc ? "DESC" : "ASC"}
        </button>

        <label className="field compact-field">
          <span>Filter</span>
          <input
            value={nameFilter}
            onChange={(event) => setNameFilter(event.currentTarget.value)}
            placeholder="username"
          />
        </label>

        <button
          className={onlyCurrentUser ? "secondary-button" : "ghost-button"}
          onClick={() => setOnlyCurrentUser((current) => !current)}
          type="button"
        >
          ONLY ME
        </button>
      </div>

      {error ? (
        <p className="error-text">
          {error instanceof Error ? error.message : t("common.unknownError")}
        </p>
      ) : null}

      {sortedEntries.length ? (
        <div className="control-row">
          {currentUserEntry ? (
            <span className="entity-chip">
              {session?.username} - {t("rooms.rank")} {currentUserEntry.rank ?? "N/A"}
            </span>
          ) : null}
          <span className="entity-chip">
            Visible {visibleEntries.length} / {sortedEntries.length}
          </span>
          <span className="entity-chip">
            Top {selectedDimension}: {formatMetric(topMetric)}
          </span>
        </div>
      ) : null}

      <article className="card rankings-card">
        {isLoading && !data ? (
          <div className="skeleton-line" style={{ height: 240 }} />
        ) : visibleEntries.length ? (
          <div className="rankings-table-wrap">
            <table className="rankings-table">
              <thead>
                <tr>
                  <th className="numeric">{t("rooms.rank")}</th>
                  <th>{t("rooms.player")}</th>
                  <th className="numeric">DELTA</th>
                  {visibleDimensions.map((dimension) => (
                    <th className="numeric" key={dimension}>
                      {dimension}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const delta = trendMap.get(entry.username);
                  const isCurrentUser =
                    currentUser !== undefined && entry.username.toLowerCase() === currentUser;

                  return (
                    <tr
                      key={`${entry.username}-${entry.rank ?? "na"}`}
                      className={isCurrentUser ? "row-highlight" : undefined}
                    >
                      <td className="numeric">{entry.rank ?? "N/A"}</td>
                      <td>{entry.username}</td>
                      <td className={`numeric ${trendClass(delta)}`}>{trendText(delta)}</td>
                      {visibleDimensions.map((dimension) => (
                        <td className="numeric" key={`${entry.username}-${dimension}`}>
                          {formatMetric(entry.metrics[dimension])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint-text">{t("rankings.empty")}</p>
        )}

        <div className="inline-actions">
          <button
            className="secondary-button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            {t("rankings.prev")}
          </button>
          <span className="hint-text">
            {t("rankings.page")}: {page}
          </span>
          <button
            className="secondary-button"
            onClick={() => setPage((current) => current + 1)}
            disabled={!data?.entries.length}
          >
            {t("rankings.next")}
          </button>
        </div>
      </article>
    </section>
  );
}
