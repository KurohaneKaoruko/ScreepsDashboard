"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  buildConsoleLocalStateKey,
  buildConsoleRealtimeChannels,
  hasConsoleFavorite,
  normalizeConsoleStreamEvents,
  readConsoleLocalState,
  removeConsoleFavorite,
  sendConsoleCommand,
  updateConsoleFavorites,
  updateConsoleHistory,
  writeConsoleLocalState,
} from "../lib/screeps/console";
import { extractUserId, probeProfileEndpoint } from "../lib/screeps/endpoints";
import { ScreepsRealtimeClient, type RealtimeConnectionState } from "../lib/screeps/realtime-client";
import type { ConsoleStreamKind, ConsoleStreamRecord } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";

const LOG_LIMIT = 1000;
const PAUSED_BUFFER_LIMIT = 300;
const TOAST_DURATION_MS = 2200;
const SHARD_OPTIONS = ["--", "shard0", "shard1", "shard2", "shard3"] as const;
const DEFAULT_CONSOLE_DRAFT = "Game.time;";
const AUTH_USER_ID_PATTERN = /\b[0-9a-f]{24}\b/i;
const ALLOWED_HTML_TAGS = new Set([
  "a",
  "b",
  "br",
  "code",
  "div",
  "em",
  "font",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "u",
  "ul",
]);
const ALLOWED_HTML_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  font: new Set(["color"]),
};
const CONNECTION_META_LABEL_BY_CHANNEL = {
  time: "console.meta.time",
  protocol: "console.meta.protocol",
  package: "console.meta.package",
} as const;
type LocalRecordRole = "system" | "command" | "response";

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  return date.toLocaleTimeString();
}

function isNearBottom(element: HTMLDivElement, threshold = 18): boolean {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance <= threshold;
}

function capRecords(records: ConsoleStreamRecord[]): ConsoleStreamRecord[] {
  if (records.length <= LOG_LIMIT) {
    return records;
  }
  return records.slice(records.length - LOG_LIMIT);
}

function getConnectionLabel(t: ReturnType<typeof useI18n>["t"], state: RealtimeConnectionState): string {
  if (state === "connecting") {
    return t("console.state.connecting");
  }
  if (state === "connected") {
    return t("console.state.connected");
  }
  if (state === "closed") {
    return t("console.state.closed");
  }
  return t("console.state.idle");
}

function getKindLabel(t: ReturnType<typeof useI18n>["t"], kind: ConsoleStreamKind): string {
  if (kind === "error") {
    return t("console.kind.error");
  }
  if (kind === "system") {
    return t("console.kind.system");
  }
  return t("console.kind.stdout");
}

function extractMetaValue(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex < 0) {
    return trimmed;
  }
  const value = trimmed.slice(separatorIndex + 1).trim();
  return value || trimmed;
}

function localizeConnectionStateToken(
  t: ReturnType<typeof useI18n>["t"],
  value: string
): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "idle") {
    return t("console.state.idle");
  }
  if (normalized === "connecting") {
    return t("console.state.connecting");
  }
  if (normalized === "connected") {
    return t("console.state.connected");
  }
  if (normalized === "closed") {
    return t("console.state.closed");
  }
  return value;
}

function localizeConnectionRecordText(
  t: ReturnType<typeof useI18n>["t"],
  record: ConsoleStreamRecord
): string {
  const channel = record.channel.trim().toLowerCase();
  if (!channel || channel === "local") {
    return record.text;
  }

  const knownLabel =
    CONNECTION_META_LABEL_BY_CHANNEL[
      channel as keyof typeof CONNECTION_META_LABEL_BY_CHANNEL
    ];
  const isConnectionEvent =
    Boolean(knownLabel) ||
    channel === "__state" ||
    channel === "auth" ||
    channel === "__error" ||
    channel.startsWith("__") ||
    channel === "message" ||
    channel === "server-message";
  if (!isConnectionEvent) {
    return record.text;
  }

  const value = extractMetaValue(record.text);
  if (!value) {
    return record.text;
  }

  if (channel === "__state") {
    return `${t("console.meta.state")}: ${localizeConnectionStateToken(t, value)}`;
  }
  if (channel === "auth") {
    return `${t("console.meta.auth")}: ${value}`;
  }
  if (channel === "__error") {
    return `${t("console.meta.error")}: ${value}`;
  }

  if (knownLabel) {
    return `${t(knownLabel)}: ${value}`;
  }

  if (channel.startsWith("__") || channel === "message" || channel === "server-message") {
    const readableChannel = channel.replace(/^__+/, "") || channel;
    return `${t("console.meta.channel", { channel: readableChannel })}: ${value}`;
  }

  return record.text;
}

function getRecordDisplayPrefix(record: ConsoleStreamRecord): string {
  const channel = record.channel.trim().toLowerCase();
  if (channel === "local:command") {
    return ">";
  }
  if (channel === "local:response") {
    return "<";
  }
  return `[${formatDateTime(record.receivedAt)}][${formatShard(record.shard)}]:`;
}

function canSendByShortcut(
  mode: "enter" | "ctrlEnter",
  event: ReactKeyboardEvent<HTMLTextAreaElement>
): boolean {
  if (mode === "ctrlEnter") {
    return event.key === "Enter" && (event.ctrlKey || event.metaKey);
  }
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeAnchorHref(rawHref: string): string | undefined {
  const href = rawHref.trim();
  if (!href) {
    return undefined;
  }
  if (/^(https?:|mailto:|#|\/)/i.test(href)) {
    return href;
  }
  return undefined;
}

function sanitizeConsoleHtml(input: string): string {
  if (!input) {
    return "";
  }
  if (typeof document === "undefined") {
    return escapeHtml(input);
  }

  const template = document.createElement("template");
  template.innerHTML = input;

  const sanitizeNode = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();

      if (!ALLOWED_HTML_TAGS.has(tagName)) {
        const textNode = document.createTextNode(element.textContent ?? "");
        element.replaceWith(textNode);
        return;
      }

      const allowedAttributes = ALLOWED_HTML_ATTRIBUTES[tagName];
      for (const attribute of [...element.attributes]) {
        const attrName = attribute.name.toLowerCase();
        if (attrName.startsWith("on")) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if (!allowedAttributes?.has(attrName)) {
          element.removeAttribute(attribute.name);
        }
      }

      if (tagName === "a") {
        const safeHref = sanitizeAnchorHref(element.getAttribute("href") ?? "");
        if (!safeHref) {
          element.removeAttribute("href");
          element.removeAttribute("target");
          element.removeAttribute("rel");
        } else {
          element.setAttribute("href", safeHref);
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        }
      }
    }

    for (const child of [...node.childNodes]) {
      sanitizeNode(child);
    }
  };

  sanitizeNode(template.content);
  return template.innerHTML;
}

function formatShard(value: string | undefined): string {
  const shard = value?.trim();
  if (!shard) {
    return "--";
  }
  return shard.toLowerCase();
}

function extractAuthUserId(payload: unknown, raw: string): string | undefined {
  const record =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const directCandidates = [
    record?.userId,
    record?._id,
    record?.id,
    record?.user,
    record?.uid,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const match = candidate.match(AUTH_USER_ID_PATTERN);
    if (match?.[0]) {
      return match[0];
    }
  }

  if (record?.data && typeof record.data === "object" && record.data !== null) {
    const nested = record.data as Record<string, unknown>;
    for (const candidate of [nested.userId, nested._id, nested.id, nested.user]) {
      if (typeof candidate !== "string") {
        continue;
      }
      const match = candidate.match(AUTH_USER_ID_PATTERN);
      if (match?.[0]) {
        return match[0];
      }
    }
  }

  const rawMatch = raw.match(AUTH_USER_ID_PATTERN);
  return rawMatch?.[0];
}

export function ConsolePanel() {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const patchSession = useAuthStore((state) => state.patchSession);
  const consoleSendMode = useSettingsStore((state) => state.consoleSendMode);

  const [selectedShard, setSelectedShard] = useState<(typeof SHARD_OPTIONS)[number]>("--");
  const [commandInput, setCommandInput] = useState(DEFAULT_CONSOLE_DRAFT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [keywordFilter, setKeywordFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<Record<ConsoleStreamKind, boolean>>({
    stdout: true,
    error: true,
    system: true,
  });
  const [history, setHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Array<{ code: string; updatedAt: string }>>([]);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>("idle");
  const [records, setRecords] = useState<ConsoleStreamRecord[]>([]);

  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const clientRef = useRef<ScreepsRealtimeClient | null>(null);
  const pausedBufferRef = useRef<ConsoleStreamRecord[]>([]);
  const pausedRef = useRef(false);
  const historyDraftRef = useRef("");

  const sessionKey = session
    ? `${session.baseUrl}|${session.username}|${session.token}|${session.userId ?? ""}|${session.accountId ?? ""}`
    : "";
  const storageKey = useMemo(() => {
    if (!session) {
      return "";
    }
    return buildConsoleLocalStateKey(session.baseUrl, session.username);
  }, [session]);
  const channels = useMemo(() => {
    if (!session) {
      return [];
    }
    return buildConsoleRealtimeChannels(session.username, session.userId ?? session.username);
  }, [session]);

  useEffect(() => {
    if (!session || session.userId) {
      return;
    }

    let cancelled = false;
    const baseUrl = session.baseUrl;
    const token = session.token;
    const username = session.username;

    void probeProfileEndpoint(baseUrl, token, username)
      .then((probeSummary) => {
        if (cancelled) {
          return;
        }
        const userId = extractUserId(probeSummary.profileSample);
        if (!userId) {
          return;
        }

        const currentSession = useAuthStore.getState().session;
        if (!currentSession) {
          return;
        }
        if (currentSession.baseUrl !== baseUrl || currentSession.token !== token) {
          return;
        }
        if (currentSession.userId === userId) {
          return;
        }

        patchSession({ userId });
      })
      .catch(() => {
        // Keep existing stream subscriptions if profile probe fails.
      });

    return () => {
      cancelled = true;
    };
  }, [patchSession, session]);

  const visibleRecords = useMemo(() => {
    const normalizedKeyword = keywordFilter.trim().toLowerCase();
    return records.filter((record) => {
      if (!kindFilter[record.kind]) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return (
        record.text.toLowerCase().includes(normalizedKeyword) ||
        record.channel.toLowerCase().includes(normalizedKeyword) ||
        formatShard(record.shard).includes(normalizedKeyword)
      );
    });
  }, [kindFilter, keywordFilter, records]);
  const renderedRecords = useMemo(
    () =>
      visibleRecords.map((record) => {
        const localizedText = localizeConnectionRecordText(t, record);
        return {
          ...record,
          displayPrefix: getRecordDisplayPrefix(record),
          safeHtml: sanitizeConsoleHtml(localizedText),
        };
      }),
    [t, visibleRecords]
  );

  const currentShortcut =
    consoleSendMode === "ctrlEnter" ? "Ctrl+Enter / Enter" : "Enter / Shift+Enter";
  const connectionLabel = getConnectionLabel(t, connectionState);
  const isCurrentFavorite = hasConsoleFavorite(favorites, commandInput);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!storageKey) {
      setCommandInput(DEFAULT_CONSOLE_DRAFT);
      setHistory([]);
      setFavorites([]);
      setHistoryCursor(null);
      return;
    }

    const localState = readConsoleLocalState(storageKey);
    setCommandInput(localState.draft || DEFAULT_CONSOLE_DRAFT);
    setHistory(localState.history);
    setFavorites(localState.favorites);
    setHistoryCursor(null);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    writeConsoleLocalState(storageKey, {
      draft: commandInput,
      history,
      favorites,
    });
  }, [commandInput, favorites, history, storageKey]);

  useEffect(() => {
    setRecords([]);
    pausedBufferRef.current = [];
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
    const subscribedChannels = new Set<string>();
    const unsubscribers: Array<() => void> = [];

    const subscribeChannel = (channel: string) => {
      const normalized = channel.trim();
      if (!normalized || subscribedChannels.has(normalized)) {
        return;
      }
      subscribedChannels.add(normalized);
      unsubscribers.push(client.subscribe(normalized));
    };

    const appendRecords = (nextRecords: ConsoleStreamRecord[]) => {
      if (nextRecords.length === 0) {
        return;
      }
      if (pausedRef.current) {
        const buffered = [...pausedBufferRef.current, ...nextRecords];
        if (buffered.length > PAUSED_BUFFER_LIMIT) {
          buffered.splice(0, buffered.length - PAUSED_BUFFER_LIMIT);
        }
        pausedBufferRef.current = buffered;
        return;
      }

      setRecords((current) => capRecords([...current, ...nextRecords]));
    };

    const offState = client.on("__state", (event) => {
      const payload = event.payload as { state?: RealtimeConnectionState };
      const nextState = payload?.state ?? "idle";
      setConnectionState(nextState);
      const normalized = normalizeConsoleStreamEvents(event);
      appendRecords(normalized);
    });

    const offAny = client.on("*", (event) => {
      if (event.channel === "__state") {
        return;
      }

      if (event.channel === "auth") {
        const userId = extractAuthUserId(event.payload, event.raw);
        if (userId) {
          for (const channel of buildConsoleRealtimeChannels(session.username, userId)) {
            subscribeChannel(channel);
          }
        }
      }

      const normalized = normalizeConsoleStreamEvents(event);
      appendRecords(normalized);
    });

    for (const channel of channels) {
      subscribeChannel(channel);
    }
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
      pausedBufferRef.current = [];
      setConnectionState("closed");
    };
  }, [channels, session, sessionKey]);

  useEffect(() => {
    if (isPaused) {
      return;
    }
    if (!autoScroll || !stickToBottom) {
      return;
    }
    const element = outputRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [autoScroll, isPaused, records, stickToBottom]);

  useEffect(() => {
    if (isPaused) {
      return;
    }
    if (pausedBufferRef.current.length === 0) {
      return;
    }
    const buffered = pausedBufferRef.current;
    pausedBufferRef.current = [];
    setRecords((current) => capRecords([...current, ...buffered]));
  }, [isPaused]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToastMessage(null);
    }, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const element = outputRef.current;
    if (!element) {
      return;
    }
    setStickToBottom(isNearBottom(element));
  }, [visibleRecords.length]);

  function appendLocalRecord(
    kind: ConsoleStreamRecord["kind"],
    text: string,
    shard?: string,
    role: LocalRecordRole = "system"
  ): void {
    const now = new Date().toISOString();
    let channel = kind === "system" ? "local" : "console";
    if (role === "command") {
      channel = "local:command";
    } else if (role === "response") {
      channel = "local:response";
    }
    setRecords((current) =>
      capRecords([
        ...current,
        {
          id: `${now}:${kind}:${text.slice(0, 24)}:${Math.random().toString(36).slice(2, 8)}`,
          channel,
          shard: formatShard(shard) === "--" ? undefined : formatShard(shard),
          text,
          receivedAt: now,
          kind,
        },
      ])
    );
  }

  async function handleSendCommand() {
    if (!session) {
      return;
    }
    setErrorMessage(null);
    const code = commandInput.trim();
    if (!code) {
      setErrorMessage(t("console.invalidCommand"));
      return;
    }

    const commandShard = selectedShard === "--" ? undefined : selectedShard;
    appendLocalRecord("system", code, commandShard, "command");
    setIsSubmitting(true);

    try {
      const result = await sendConsoleCommand(
        session,
        code,
        commandShard
      );
      setHistory((current) => updateConsoleHistory(current, code));
      setHistoryCursor(null);
      if (result.feedback) {
        appendLocalRecord("stdout", result.feedback, commandShard, "response");
        setToastMessage(result.feedback);
      } else {
        setToastMessage(t("console.saved"));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("console.unknownError");
      setErrorMessage(detail);
      appendLocalRecord("error", detail, commandShard, "response");
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
    setToastMessage(t("console.toast.reconnected"));
  }

  function handleClearOutput() {
    pausedBufferRef.current = [];
    setRecords([]);
    setStickToBottom(true);
    setToastMessage(t("console.toast.cleared"));
  }

  function handleTogglePause() {
    setIsPaused((current) => {
      const next = !current;
      setToastMessage(next ? t("console.toast.pauseOn") : t("console.toast.pauseOff"));
      return next;
    });
  }

  function handleOutputScroll() {
    const element = outputRef.current;
    if (!element) {
      return;
    }
    setStickToBottom(isNearBottom(element));
  }

  function handleToggleFavorite() {
    const command = commandInput.trim();
    if (!command) {
      setErrorMessage(t("console.invalidCommand"));
      return;
    }
    setErrorMessage(null);
    if (hasConsoleFavorite(favorites, command)) {
      setFavorites((current) => removeConsoleFavorite(current, command));
      setToastMessage(t("console.toast.favoriteRemoved"));
      return;
    }
    setFavorites((current) => updateConsoleFavorites(current, command));
    setToastMessage(t("console.toast.favoriteAdded"));
  }

  function handlePickFavorite(command: string) {
    setCommandInput(command);
    setHistoryCursor(null);
    historyDraftRef.current = "";
    inputRef.current?.focus();
    setToastMessage(t("console.toast.copiedFavorite"));
  }

  function handleCommandKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (canSendByShortcut(consoleSendMode, event)) {
      event.preventDefault();
      void handleSendCommand();
      return;
    }

    if (
      event.key === "ArrowUp" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      history.length > 0
    ) {
      event.preventDefault();
      setHistoryCursor((current) => {
        if (current === null) {
          historyDraftRef.current = commandInput;
          const nextIndex = 0;
          setCommandInput(history[nextIndex] ?? "");
          return nextIndex;
        }
        const nextIndex = Math.min(current + 1, history.length - 1);
        setCommandInput(history[nextIndex] ?? "");
        return nextIndex;
      });
      return;
    }

    if (
      event.key === "ArrowDown" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      history.length > 0
    ) {
      event.preventDefault();
      setHistoryCursor((current) => {
        if (current === null) {
          return null;
        }
        const nextIndex = current - 1;
        if (nextIndex < 0) {
          setCommandInput(historyDraftRef.current);
          return null;
        }
        setCommandInput(history[nextIndex] ?? "");
        return nextIndex;
      });
    }
  }

  function toggleKind(kind: ConsoleStreamKind) {
    setKindFilter((current) => ({
      ...current,
      [kind]: !current[kind],
    }));
  }

  return (
    <section className="panel dashboard-panel console-panel console-terminal-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{t("console.title")}</h1>
        </div>
      </header>

      <article className="card console-terminal-card">
        <div className="console-terminal-toolbar">
          <div className="console-toolbar-left">
            <span className={`entity-chip console-connection-chip state-${connectionState}`}>
              {t("console.connection")}: {connectionLabel}
            </span>
            <button className="ghost-button" onClick={handleReconnect} type="button">
              {t("console.reconnect")}
            </button>
            <button className="ghost-button" onClick={handleTogglePause} type="button">
              {isPaused ? t("console.resume") : t("console.pause")}
            </button>
            <label className="check-field">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.currentTarget.checked)}
              />
              <span className="check-indicator" />
              <span className="check-label">{t("console.autoScroll")}</span>
            </label>
            <div className="console-kind-filter-row">
              {(["stdout", "error", "system"] as const).map((kind) => (
                <button
                  key={kind}
                  className={kindFilter[kind] ? "chip active console-kind-chip" : "chip console-kind-chip"}
                  onClick={() => toggleKind(kind)}
                  type="button"
                >
                  {getKindLabel(t, kind)}
                </button>
              ))}
            </div>
          </div>

          <div className="console-toolbar-right">
            <label className="console-toolbar-field console-shard-field" title={t("console.shard")}>
              <select
                aria-label={t("console.shard")}
                value={selectedShard}
                className="compact-select"
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
            <label className="console-toolbar-field console-filter-field" title={t("console.filterKeyword")}>
              <input
                aria-label={t("console.filterKeyword")}
                value={keywordFilter}
                onChange={(event) => setKeywordFilter(event.currentTarget.value)}
                placeholder={t("console.filterKeyword")}
              />
            </label>
          </div>
        </div>

        <div className="console-output-shell">
          <div className="console-output-scroll" ref={outputRef} onScroll={handleOutputScroll}>
            {renderedRecords.length === 0 ? (
              <p className="hint-text console-empty">{t("console.empty")}</p>
            ) : (
              <div className="console-log-list">
                {renderedRecords.map((record) => (
                  <div className={`console-log-line kind-${record.kind}`} key={record.id}>
                    <span className="console-log-prefix">{record.displayPrefix}</span>
                    <div
                      className="console-log-text"
                      dangerouslySetInnerHTML={{ __html: record.safeHtml }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {favorites.length > 0 ? (
          <div className="console-favorites-row">
            <span className="console-favorites-label">{t("console.favorites")}</span>
            <div className="console-favorites-list">
              {favorites.map((favorite) => (
                <button
                  key={favorite.code}
                  className="ghost-button console-favorite-chip"
                  onClick={() => handlePickFavorite(favorite.code)}
                  title={favorite.code}
                  type="button"
                >
                  {favorite.code}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="console-input-shell">
          <label className="field">
            <span>{t("console.command")}</span>
            <textarea
              ref={inputRef}
              className={`console-input-textarea ${historyCursor !== null ? "history-browsing" : ""}`}
              value={commandInput}
              onChange={(event) => {
                setCommandInput(event.currentTarget.value);
                setHistoryCursor(null);
              }}
              onKeyDown={handleCommandKeyDown}
              placeholder={t("console.placeholder")}
              rows={2}
            />
          </label>
          <div className="inline-actions console-input-actions">
            <button
              className="secondary-button"
              onClick={() => void handleSendCommand()}
              type="button"
              disabled={isSubmitting}
            >
              {isSubmitting ? t("console.sending") : t("console.send")}
            </button>
            <button
              className="ghost-button"
              onClick={handleToggleFavorite}
              type="button"
              title={t("console.favorites")}
            >
              {isCurrentFavorite ? t("console.removeFavorite") : t("console.addFavorite")}
            </button>
            <button className="ghost-button" onClick={handleClearOutput} type="button">
              {t("console.clear")}
            </button>
            <span className="hint-text console-shortcut-hint">
              {t("console.shortcutHint", { shortcut: currentShortcut })}
            </span>
          </div>
        </div>
      </article>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {toastMessage ? <div className="market-toast">{toastMessage}</div> : null}
    </section>
  );
}
