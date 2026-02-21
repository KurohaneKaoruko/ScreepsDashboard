"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  buildConsoleRealtimeChannels,
  normalizeConsoleStreamEvent,
  sendConsoleCommand,
} from "../lib/screeps/console";
import { ScreepsRealtimeClient, type RealtimeConnectionState } from "../lib/screeps/realtime-client";
import type { ConsoleStreamRecord } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";

const LOG_LIMIT = 500;
const TOAST_DURATION_MS = 2200;
const SHARD_OPTIONS = ["--", "shard0", "shard1", "shard2", "shard3"] as const;

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  return date.toLocaleTimeString();
}

function mapStateLabel(isZh: boolean, state: RealtimeConnectionState): string {
  if (isZh) {
    if (state === "connecting") {
      return "连接中";
    }
    if (state === "connected") {
      return "已连接";
    }
    if (state === "closed") {
      return "已断开";
    }
    return "空闲";
  }

  if (state === "connecting") {
    return "Connecting";
  }
  if (state === "connected") {
    return "Connected";
  }
  if (state === "closed") {
    return "Closed";
  }
  return "Idle";
}

export function ConsolePanel() {
  const { locale } = useI18n();
  const session = useAuthStore((state) => state.session);
  const isZh = locale === "zh-CN";

  const [selectedShard, setSelectedShard] = useState<(typeof SHARD_OPTIONS)[number]>("--");
  const [commandInput, setCommandInput] = useState("Game.time;");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>("idle");
  const [records, setRecords] = useState<ConsoleStreamRecord[]>([]);

  const outputRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<ScreepsRealtimeClient | null>(null);

  const sessionKey = session
    ? `${session.baseUrl}|${session.username}|${session.token}|${session.accountId ?? ""}`
    : "";
  const channels = useMemo(() => {
    if (!session) {
      return [];
    }
    return buildConsoleRealtimeChannels(session.username, session.accountId ?? session.username);
  }, [session]);

  const labels = useMemo(
    () =>
      isZh
        ? {
            title: "控制台",
            subtitle: "发送命令并实时查看输出流。",
            shard: "Shard",
            command: "命令",
            commandPlaceholder: "输入要执行的 JS 代码，例如 Game.time;",
            send: "发送",
            sending: "发送中...",
            clear: "清空输出",
            reconnect: "重新连接",
            autoScroll: "自动滚动",
            output: "输出",
            connection: "连接状态",
            emptyOutput: "暂无输出，先发送命令或等待实时日志。",
            sent: "命令已发送。",
            unknownError: "未知错误",
            invalidCommand: "命令不能为空。",
          }
        : {
            title: "Console",
            subtitle: "Run commands and watch realtime output.",
            shard: "Shard",
            command: "Command",
            commandPlaceholder: "Enter JS code to execute, e.g. Game.time;",
            send: "Send",
            sending: "Sending...",
            clear: "Clear",
            reconnect: "Reconnect",
            autoScroll: "Auto scroll",
            output: "Output",
            connection: "Connection",
            emptyOutput: "No output yet. Send a command or wait for stream events.",
            sent: "Command sent.",
            unknownError: "Unknown error",
            invalidCommand: "Command cannot be empty.",
          },
    [isZh]
  );

  useEffect(() => {
    setRecords([]);
    setConnectionState("idle");

    if (!session) {
      return;
    }

    const client = new ScreepsRealtimeClient({
      baseUrl: session.baseUrl,
      token: session.token,
      reconnect: true,
    });
    clientRef.current = client;

    const appendRecord = (eventRecord: ConsoleStreamRecord) => {
      setRecords((current) => {
        const next = [...current, eventRecord];
        if (next.length > LOG_LIMIT) {
          next.splice(0, next.length - LOG_LIMIT);
        }
        return next;
      });
    };

    const offState = client.on("__state", (event) => {
      const payload = event.payload as { state?: RealtimeConnectionState };
      const nextState = payload?.state ?? "idle";
      setConnectionState(nextState);
      const normalized = normalizeConsoleStreamEvent(event);
      if (normalized) {
        appendRecord(normalized);
      }
    });

    const offAny = client.on("*", (event) => {
      if (event.channel === "__state") {
        return;
      }
      const normalized = normalizeConsoleStreamEvent(event);
      if (normalized) {
        appendRecord(normalized);
      }
    });

    const unsubscribers = channels.map((channel) => client.subscribe(channel));
    client.connect();

    return () => {
      offState();
      offAny();
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      client.disconnect();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
      setConnectionState("closed");
    };
  }, [channels, session, sessionKey]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const element = outputRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [autoScroll, records]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToastMessage(null);
    }, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  function appendLocalRecord(kind: ConsoleStreamRecord["kind"], text: string): void {
    const now = new Date().toISOString();
    setRecords((current) => {
      const next = [
        ...current,
        {
          id: `${now}:${kind}:${text.slice(0, 24)}`,
          channel: kind === "system" ? "local" : "console",
          text,
          receivedAt: now,
          kind,
        },
      ];
      if (next.length > LOG_LIMIT) {
        next.splice(0, next.length - LOG_LIMIT);
      }
      return next;
    });
  }

  async function handleSendCommand() {
    if (!session) {
      return;
    }
    setErrorMessage(null);
    const code = commandInput.trim();
    if (!code) {
      setErrorMessage(labels.invalidCommand);
      return;
    }

    appendLocalRecord("system", `$ ${code}`);
    setIsSubmitting(true);

    try {
      const result = await sendConsoleCommand(
        session,
        code,
        selectedShard === "--" ? undefined : selectedShard
      );
      if (result.feedback) {
        appendLocalRecord("stdout", result.feedback);
        setToastMessage(result.feedback);
      } else {
        setToastMessage(labels.sent);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : labels.unknownError;
      setErrorMessage(detail);
      appendLocalRecord("error", detail);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReconnect() {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    client.disconnect();
    client.connect();
    setToastMessage(isZh ? "已重连控制台流。" : "Console stream reconnected.");
  }

  return (
    <section className="panel dashboard-panel console-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{labels.title}</h1>
          <p className="page-subtitle">{labels.subtitle}</p>
        </div>
      </header>

      <div className="console-layout">
        <article className="card console-control-card">
          <div className="console-state-row">
            <span className="entity-chip">
              {labels.connection}: {mapStateLabel(isZh, connectionState)}
            </span>
          </div>

          <label className="field compact-field">
            <span>{labels.shard}</span>
            <select
              value={selectedShard}
              onChange={(event) =>
                setSelectedShard(event.currentTarget.value as (typeof SHARD_OPTIONS)[number])
              }
            >
              {SHARD_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{labels.command}</span>
            <textarea
              value={commandInput}
              onChange={(event) => setCommandInput(event.currentTarget.value)}
              placeholder={labels.commandPlaceholder}
              rows={6}
            />
          </label>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <div className="inline-actions console-actions">
            <button
              className="secondary-button"
              onClick={() => void handleSendCommand()}
              type="button"
              disabled={isSubmitting}
            >
              {isSubmitting ? labels.sending : labels.send}
            </button>
            <button
              className="ghost-button"
              onClick={() => setRecords([])}
              type="button"
            >
              {labels.clear}
            </button>
            <button
              className="ghost-button"
              onClick={handleReconnect}
              type="button"
            >
              {labels.reconnect}
            </button>
            <label className="check-field">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.currentTarget.checked)}
              />
              <span className="check-indicator" />
              <span className="check-label">{labels.autoScroll}</span>
            </label>
          </div>
        </article>

        <article className="card console-output-card">
          <header className="console-output-header">
            <h2>{labels.output}</h2>
          </header>
          <div className="console-output-scroll" ref={outputRef}>
            {records.length === 0 ? (
              <p className="hint-text console-empty">{labels.emptyOutput}</p>
            ) : (
              <div className="console-log-list">
                {records.map((record) => (
                  <div
                    className={`console-log-line kind-${record.kind}`}
                    key={record.id}
                  >
                    <span className="console-log-time">
                      {formatDateTime(record.receivedAt)}
                    </span>
                    <span className="console-log-channel">{record.channel}</span>
                    <pre className="console-log-text">{record.text}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>

      {toastMessage ? <div className="market-toast">{toastMessage}</div> : null}
    </section>
  );
}
