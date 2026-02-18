"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { TranslationKey } from "../lib/i18n/dict";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchDashboardSnapshot } from "../lib/screeps/dashboard";
import { probeSupportedEndpoints } from "../lib/screeps/endpoints";
import { useAuthStore } from "../stores/auth-store";
import {
  refreshIntervalValues,
  useSettingsStore,
} from "../stores/settings-store";

function formatNumber(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }
  return `${value.toFixed(2)}%`;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function refreshLabelKey(value: number): TranslationKey {
  if (value === 30_000) {
    return "refresh.30s";
  }
  if (value === 60_000) {
    return "refresh.60s";
  }
  if (value === 120_000) {
    return "refresh.120s";
  }
  return "refresh.300s";
}

export function DashboardPanel() {
  const { t, locale } = useI18n();
  const session = useAuthStore((state) => state.session);
  const setSession = useAuthStore((state) => state.setSession);
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);
  const setRefreshIntervalMs = useSettingsStore(
    (state) => state.setRefreshIntervalMs
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [isReprobing, setIsReprobing] = useState(false);

  const refreshOptions = useMemo(
    () =>
      refreshIntervalValues.map((value) => ({
        value,
        label: t(refreshLabelKey(value)),
      })),
    [t]
  );

  if (!session) {
    return null;
  }

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    ["dashboard", session.baseUrl, session.token, session.verifiedAt],
    () => fetchDashboardSnapshot(session),
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 6_000,
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

  async function handleReprobe() {
    if (!session) {
      return;
    }

    const activeSession = session;
    setActionError(null);
    setIsReprobing(true);

    try {
      const summary = await probeSupportedEndpoints(
        activeSession.baseUrl,
        activeSession.token
      );
      setSession({
        ...activeSession,
        endpointMap: summary.endpointMap,
        verifiedAt: summary.verifiedAt,
        probes: summary.probes,
      });
      await mutate();
    } catch (probeError) {
      setActionError(errorToMessage(probeError));
    } finally {
      setIsReprobing(false);
    }
  }

  return (
    <section className="panel dashboard-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{t("dashboard.title")}</h1>
          <p className="page-subtitle">
            {t("dashboard.subtitle", {
              username: session.username,
              baseUrl: session.baseUrl,
            })}
          </p>
        </div>
        <div className="header-actions">
          <label className="refresh-select">
            <span>{t("dashboard.refreshInterval")}</span>
            <select
              value={refreshIntervalMs}
              onChange={(event) => setRefreshIntervalMs(Number(event.currentTarget.value))}
            >
              {refreshOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="secondary-button" onClick={() => void mutate()}>
            {t("common.refreshNow")}
          </button>
          <button
            className="secondary-button"
            onClick={() => void handleReprobe()}
            disabled={isReprobing}
          >
            {isReprobing ? t("dashboard.probing") : t("dashboard.reprobe")}
          </button>
        </div>
      </header>

      <div className="status-strip">
        <span>
          {t("dashboard.endpointCheck")}: {formatTime(session.verifiedAt)}
        </span>
        <span>
          {t("dashboard.lastFetch")}: {formatTime(data?.fetchedAt)}
        </span>
        <span>{isValidating ? t("common.syncing") : t("common.idle")}</span>
      </div>

      {actionError ? <p className="error-text">{actionError}</p> : null}
      {error ? <p className="error-text">{errorToMessage(error)}</p> : null}
      {isLoading ? <p className="hint-text">{t("dashboard.loading")}</p> : null}

      <div className="card-grid">
        <article className="card">
          <h2>{t("dashboard.resourceSummary")}</h2>
          <div className="metric-grid">
            <div>
              <span>{t("dashboard.credits")}</span>
              <strong>{formatNumber(data?.resources.credits)}</strong>
            </div>
            <div>
              <span>{t("dashboard.cpuLimit")}</span>
              <strong>{formatNumber(data?.resources.cpuLimit)}</strong>
            </div>
            <div>
              <span>{t("dashboard.cpuUsed")}</span>
              <strong>{formatNumber(data?.resources.cpuUsed)}</strong>
            </div>
            <div>
              <span>{t("dashboard.cpuBucket")}</span>
              <strong>{formatNumber(data?.resources.cpuBucket)}</strong>
            </div>
            <div>
              <span>{t("dashboard.gclLevel")}</span>
              <strong>{formatNumber(data?.resources.gclLevel)}</strong>
            </div>
            <div>
              <span>{t("dashboard.gclProgress")}</span>
              <strong>{formatPercent(data?.resources.gclProgressPercent)}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <h2>{t("dashboard.rooms")}</h2>
          {data?.rooms.length ? (
            <div className="room-table">
              <div className="room-head">
                <span>{t("dashboard.room")}</span>
                <span>{t("dashboard.owner")}</span>
                <span>{t("dashboard.rcl")}</span>
                <span>{t("dashboard.energy")}</span>
              </div>
              {data.rooms.map((room) => (
                <div className="room-row" key={room.name}>
                  <span>{room.name}</span>
                  <span>{room.owner ?? t("common.notAvailable")}</span>
                  <span>{room.level ?? t("common.notAvailable")}</span>
                  <span>
                    {room.energyAvailable ?? t("common.notAvailable")} /{" "}
                    {room.energyCapacity ?? t("common.notAvailable")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint-text">{t("dashboard.noRooms")}</p>
          )}
        </article>
      </div>

      <div className="card-grid">
        <article className="card">
          <h2>{t("dashboard.endpointProbes")}</h2>
          <div className="probe-list">
            {session.probes.map((probe) => (
              <div key={`${probe.group}-${probe.candidateId}`} className="probe-row">
                <span>{probe.group}</span>
                <span>{probe.endpoint}</span>
                <span>{probe.status || t("common.notAvailable")}</span>
                <span className={probe.ok ? "ok-text" : "error-text-inline"}>
                  {probe.ok ? t("dashboard.available") : probe.error ?? t("dashboard.failed")}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>{t("dashboard.rawPayloads")}</h2>
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
      </div>
    </section>
  );
}
