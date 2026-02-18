"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchDashboardSnapshot } from "../lib/screeps/dashboard";
import { probeSupportedEndpoints } from "../lib/screeps/endpoints";
import { useAuthStore } from "../stores/auth-store";
import {
  refreshIntervalOptions,
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

function formatTime(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export function DashboardPanel() {
  const session = useAuthStore((state) => state.session);
  const setSession = useAuthStore((state) => state.setSession);
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);
  const setRefreshIntervalMs = useSettingsStore(
    (state) => state.setRefreshIntervalMs
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [isReprobing, setIsReprobing] = useState(false);

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
          <h1 className="page-title">User Data</h1>
          <p className="page-subtitle">
            {session.username} at {session.baseUrl}
          </p>
        </div>
        <div className="header-actions">
          <label className="refresh-select">
            <span>Refresh interval</span>
            <select
              value={refreshIntervalMs}
              onChange={(event) => setRefreshIntervalMs(Number(event.currentTarget.value))}
            >
              {refreshIntervalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="secondary-button" onClick={() => void mutate()}>
            Refresh now
          </button>
          <button
            className="secondary-button"
            onClick={() => void handleReprobe()}
            disabled={isReprobing}
          >
            {isReprobing ? "Probing..." : "Re-probe endpoints"}
          </button>
        </div>
      </header>

      <div className="status-strip">
        <span>Endpoint check: {formatTime(session.verifiedAt)}</span>
        <span>Last fetch: {formatTime(data?.fetchedAt)}</span>
        <span>{isValidating ? "Syncing..." : "Idle"}</span>
      </div>

      {actionError ? <p className="error-text">{actionError}</p> : null}
      {error ? <p className="error-text">{errorToMessage(error)}</p> : null}
      {isLoading ? <p className="hint-text">Loading game data...</p> : null}

      <div className="card-grid">
        <article className="card">
          <h2>Resource Summary</h2>
          <div className="metric-grid">
            <div>
              <span>Credits</span>
              <strong>{formatNumber(data?.resources.credits)}</strong>
            </div>
            <div>
              <span>CPU Limit</span>
              <strong>{formatNumber(data?.resources.cpuLimit)}</strong>
            </div>
            <div>
              <span>CPU Used</span>
              <strong>{formatNumber(data?.resources.cpuUsed)}</strong>
            </div>
            <div>
              <span>CPU Bucket</span>
              <strong>{formatNumber(data?.resources.cpuBucket)}</strong>
            </div>
            <div>
              <span>GCL Level</span>
              <strong>{formatNumber(data?.resources.gclLevel)}</strong>
            </div>
            <div>
              <span>GCL Progress</span>
              <strong>{formatPercent(data?.resources.gclProgressPercent)}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <h2>Rooms</h2>
          {data?.rooms.length ? (
            <div className="room-table">
              <div className="room-head">
                <span>Room</span>
                <span>Owner</span>
                <span>RCL</span>
                <span>Energy</span>
              </div>
              {data.rooms.map((room) => (
                <div className="room-row" key={room.name}>
                  <span>{room.name}</span>
                  <span>{room.owner ?? "--"}</span>
                  <span>{room.level ?? "--"}</span>
                  <span>
                    {room.energyAvailable ?? "--"} / {room.energyCapacity ?? "--"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint-text">
              No room payload could be parsed. Check endpoint or permissions.
            </p>
          )}
        </article>
      </div>

      <div className="card-grid">
        <article className="card">
          <h2>Endpoint Probes</h2>
          <div className="probe-list">
            {session.probes.map((probe) => (
              <div key={`${probe.group}-${probe.candidateId}`} className="probe-row">
                <span>{probe.group}</span>
                <span>{probe.endpoint}</span>
                <span>{probe.status || "--"}</span>
                <span className={probe.ok ? "ok-text" : "error-text-inline"}>
                  {probe.ok ? "Available" : probe.error ?? "Failed"}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Raw Payloads (Debug)</h2>
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
