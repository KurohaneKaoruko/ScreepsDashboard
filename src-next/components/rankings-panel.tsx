"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchRankingSnapshot } from "../lib/screeps/rankings";
import type { RankingMode } from "../lib/screeps/types";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";

const DEFAULT_SERVER_URL = "https://screeps.com";
const PAGE_SIZE = 20;

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

function resolveDimensionLabel(
  dimension: string,
  t: (key: "rankings.metricScore" | "rankings.metricPower") => string,
): string {
  if (dimension === "score") {
    return t("rankings.metricScore");
  }
  if (dimension === "power") {
    return t("rankings.metricPower");
  }
  return dimension;
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
  const [nameFilter, setNameFilter] = useState("");
  const [onlyCurrentUser, setOnlyCurrentUser] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    ["rankings", baseUrl, mode, season, page, session?.username ?? ""],
    () =>
      fetchRankingSnapshot(baseUrl, {
        mode,
        season,
        page,
        pageSize: PAGE_SIZE,
        username: session?.username,
      }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 8_000,
    }
  );

  const activeDimension = mode === "power" ? "power" : "score";
  const visibleDimensions = [activeDimension];

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

  const sortedEntries = useMemo(() => data?.entries ?? [], [data?.entries]);

  const currentUser = session?.username.trim().toLowerCase();
  const currentUserEntry = currentUser
    ? sortedEntries.find((entry) => entry.username.toLowerCase() === currentUser) ??
      (data?.selfEntry?.username.toLowerCase() === currentUser ? data.selfEntry : undefined)
    : undefined;

  const visibleEntries = useMemo(() => {
    const keyword = nameFilter.trim().toLowerCase();
    const filtered = sortedEntries.filter((entry) => {
      if (!keyword) {
        return true;
      }

      return entry.username.toLowerCase().includes(keyword);
    });

    if (!onlyCurrentUser) {
      return filtered;
    }

    if (!currentUser) {
      return [];
    }

    const inPage = filtered.find((entry) => entry.username.toLowerCase() === currentUser);
    if (inPage) {
      return [inPage];
    }

    if (
      data?.selfEntry &&
      data.selfEntry.username.toLowerCase() === currentUser &&
      (!keyword || data.selfEntry.username.toLowerCase().includes(keyword))
    ) {
      return [data.selfEntry];
    }

    return [];
  }, [currentUser, data?.selfEntry, nameFilter, onlyCurrentUser, sortedEntries]);

  const topMetric = visibleEntries.find(
    (entry) => entry.metrics[activeDimension] !== undefined && entry.metrics[activeDimension] !== null
  )?.metrics[activeDimension];
  const selectedDimensionLabel = resolveDimensionLabel(activeDimension, t);
  const modeMetricHint = mode === "power" ? t("rankings.metricHelpPower") : t("rankings.metricHelpWorld");
  const hasNextPage =
    typeof data?.totalCount === "number" && data.totalCount > 0
      ? page * PAGE_SIZE < data.totalCount
      : Boolean(data?.entries.length);

  const jumpToSearchedUser = useCallback(async () => {
    const username = nameFilter.trim();
    if (!username) {
      return;
    }

    setIsSearching(true);
    try {
      const snapshot = await fetchRankingSnapshot(baseUrl, {
        mode,
        season,
        page: 1,
        pageSize: PAGE_SIZE,
        username,
      });
      const rank = snapshot.selfEntry?.rank;
      if (rank === undefined) {
        return;
      }
      const targetPage = Math.max(1, Math.floor((rank - 1) / PAGE_SIZE) + 1);
      if (targetPage !== page) {
        setPage(targetPage);
      }
    } finally {
      setIsSearching(false);
    }
  }, [baseUrl, mode, nameFilter, page, season]);

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
            <option value="power">{t("rankings.power")}</option>
          </select>
        </label>

        <label className="field compact-field">
          <span>{t("rankings.season")}</span>
          <select
            value={season ?? data?.season ?? data?.seasons[0] ?? ""}
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

        <label className="field compact-field">
          <span>{t("rankings.searchUser")}</span>
          <input
            value={nameFilter}
            onChange={(event) => setNameFilter(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              void jumpToSearchedUser();
            }}
            placeholder={t("rankings.searchPlaceholder")}
          />
        </label>

        <button
          className="secondary-button"
          onClick={() => void jumpToSearchedUser()}
          disabled={isSearching || nameFilter.trim().length === 0}
          type="button"
        >
          {t("rankings.jump")}
        </button>

        <button
          className={onlyCurrentUser ? "secondary-button" : "ghost-button"}
          onClick={() => setOnlyCurrentUser((current) => !current)}
          type="button"
        >
          ONLY ME
        </button>
      </div>
      <p className="hint-text">{modeMetricHint}</p>

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
            Top {selectedDimensionLabel}: {formatMetric(topMetric)}
          </span>
        </div>
      ) : null}

      <article className="card rankings-card">
        {isLoading && !data ? (
          <div className="skeleton-line" style={{ height: 240 }} />
        ) : visibleEntries.length ? (
          <div className="rankings-table-wrap">
            <table className="rankings-table">
              <colgroup>
                <col className="rankings-col-rank" />
                <col className="rankings-col-player" />
                <col className="rankings-col-delta" />
                {visibleDimensions.map((dimension) => (
                  <col className="rankings-col-metric" key={`col-${dimension}`} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="numeric">{t("rooms.rank")}</th>
                  <th className="rankings-player-col">{t("rooms.player")}</th>
                  <th className="numeric">{t("rankings.delta")}</th>
                  {visibleDimensions.map((dimension) => (
                    <th className="numeric" key={dimension}>
                      {resolveDimensionLabel(dimension, t)}
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
                      <td className="rankings-player-cell" title={entry.username}>
                        <span className="rankings-player-text">{entry.username}</span>
                      </td>
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

        <div className="inline-actions rankings-pagination">
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
            disabled={!hasNextPage}
          >
            {t("rankings.next")}
          </button>
        </div>
      </article>
    </section>
  );
}
