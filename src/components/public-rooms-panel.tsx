"use client";

import { type FormEvent, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchPublicSnapshot } from "../lib/screeps/public";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";

const DEFAULT_SERVER_URL = "https://screeps.com";

export function PublicRoomsPanel() {
  const { locale, t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const [serverInput, setServerInput] = useState(session?.baseUrl ?? DEFAULT_SERVER_URL);
  const [activeBaseUrl, setActiveBaseUrl] = useState(
    normalizeBaseUrl(session?.baseUrl ?? DEFAULT_SERVER_URL)
  );
  const [formError, setFormError] = useState<string | null>(null);

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    ["public-rooms", activeBaseUrl],
    () => fetchPublicSnapshot(activeBaseUrl),
    {
      refreshInterval: 120_000,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  function formatTime(value: string | undefined): string {
    if (!value) {
      return t("common.notAvailable");
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString(locale);
  }

  function handleApplyServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      const normalized = normalizeBaseUrl(serverInput);
      setActiveBaseUrl(normalized);
    } catch (applyError) {
      setFormError(
        applyError instanceof Error ? applyError.message : t("common.unknownError")
      );
    }
  }

  return (
    <section className="panel dashboard-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{t("rooms.title")}</h1>
          <p className="page-subtitle">
            {session ? t("rooms.subtitleAuth") : t("rooms.subtitleGuest")}
          </p>
        </div>
      </header>

      <form className="inline-actions" onSubmit={handleApplyServer}>
        <label className="field compact-field">
          <span>{t("rooms.serverUrl")}</span>
          <input
            value={serverInput}
            onChange={(event) => setServerInput(event.currentTarget.value)}
            placeholder="https://screeps.com"
            autoComplete="url"
          />
        </label>
        <button className="secondary-button" type="submit">
          {t("rooms.applyServer")}
        </button>
        <button className="secondary-button" type="button" onClick={() => void mutate()}>
          {t("common.refreshNow")}
        </button>
      </form>

      <div className="status-strip">
        <span>{activeBaseUrl}</span>
        <span>
          {t("common.lastFetch")}: {formatTime(data?.fetchedAt)}
        </span>
        <span>{isValidating ? t("common.syncing") : t("common.idle")}</span>
      </div>

      {formError ? <p className="error-text">{formError}</p> : null}
      {error ? (
        <p className="error-text">
          {error instanceof Error ? error.message : t("common.unknownError")}
        </p>
      ) : null}
      {isLoading ? <p className="hint-text">{t("rooms.loading")}</p> : null}

      {data?.errors.length ? (
        <article className="card">
          <h2>{t("rooms.publicErrors")}</h2>
          <ul className="error-list">
            {data.errors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ) : null}

      <div className="card-grid">
        <article className="card">
          <h2>{t("rooms.leaderboard")}</h2>
          {data?.leaderboard ? (
            <>
              <p className="hint-text">
                {t("rooms.sourceLabel")}: {data.leaderboard.source}
                {data.leaderboard.season
                  ? ` | ${t("rooms.seasonLabel")}: ${data.leaderboard.season}`
                  : ""}
              </p>
              <div className="room-table">
                <div className="room-head">
                  <span>{t("rooms.rank")}</span>
                  <span>{t("rooms.player")}</span>
                  <span>{t("rooms.score")}</span>
                  <span />
                </div>
                {data.leaderboard.entries.map((entry) => (
                  <div className="room-row" key={`${entry.username}-${entry.rank ?? "na"}`}>
                    <span>{entry.rank ?? t("common.notAvailable")}</span>
                    <span>{entry.username}</span>
                    <span>{entry.score ?? t("common.notAvailable")}</span>
                    <span />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="hint-text">{t("rooms.leaderboardEmpty")}</p>
          )}
        </article>

        <article className="card">
          <h2>{t("rooms.mapStats")}</h2>
          {data?.map ? (
            <>
              <p className="hint-text">
                {t("rooms.terrainRoom")}: {data.map.terrainRoom} |{" "}
                {data.map.terrainAvailable
                  ? t("rooms.terrainAvailable")
                  : t("rooms.terrainUnavailable")}
              </p>
              <p className="hint-text">
                {t("rooms.sources")}: {data.map.sources.join(", ")}
              </p>
              {data.map.roomStats.length ? (
                <div className="room-table">
                  <div className="room-head">
                    <span>{t("rooms.room")}</span>
                    <span>{t("dashboard.owner")}</span>
                    <span>{t("rooms.level")}</span>
                    <span>{t("rooms.novice")}</span>
                  </div>
                  {data.map.roomStats.map((room) => (
                    <div className="room-row" key={room.room}>
                      <span>{room.room}</span>
                      <span>{room.owner ?? t("common.notAvailable")}</span>
                      <span>{room.level ?? t("common.notAvailable")}</span>
                      <span>
                        {room.novice === undefined
                          ? t("common.notAvailable")
                          : room.novice
                            ? t("rooms.true")
                            : t("rooms.false")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint-text">{t("rooms.mapStatsEmpty")}</p>
              )}
            </>
          ) : (
            <p className="hint-text">{t("rooms.mapStatsEmpty")}</p>
          )}
        </article>
      </div>

      <article className="card">
        <h2>{t("common.debugData")}</h2>
        <pre className="raw-json">
          {JSON.stringify(
            {
              statuses: data?.statuses,
              raw: data?.raw,
            },
            null,
            2
          )}
        </pre>
      </article>
    </section>
  );
}
