"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  fetchConversationMessages,
  fetchMessagesPage,
  resolveUsernamesByIds,
  sendMessage,
} from "../lib/screeps/messages";
import type { MessageSummary } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";

const PAGE_LIMIT = 80;
const TOAST_DURATION_MS = 2200;

interface ConversationSummary {
  key: string;
  peer: string;
  lastAt?: string;
  lastAtTime: number;
  lastText: string;
  unreadCount: number;
  messageCount: number;
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
}

function formatConversationTime(value: string | undefined, locale: string): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(
    locale,
    sameYear ? { month: "2-digit", day: "2-digit" } : { year: "2-digit", month: "2-digit", day: "2-digit" }
  );
}

function normalizePeerKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function isLikelyAccountId(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return /^[0-9a-f]{16,}$/i.test(trimmed);
}

function canonicalPeerKey(
  peer: string | undefined,
  displayNameLookup: Map<string, string>
): string | undefined {
  const rawKey = normalizePeerKey(peer);
  if (!rawKey) {
    return undefined;
  }
  const mapped = displayNameLookup.get(rawKey);
  return normalizePeerKey(mapped) ?? rawKey;
}

function mergeMessages(existing: MessageSummary[], incoming: MessageSummary[]): MessageSummary[] {
  const merged = new Map<string, MessageSummary>();
  for (const item of existing) {
    merged.set(buildMessageMergeKey(item), item);
  }
  for (const item of incoming) {
    const key = buildMessageMergeKey(item);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...current,
      folder: current.folder,
      from: current.from ?? item.from,
      to: current.to ?? item.to,
      subject: current.subject ?? item.subject,
      text: current.text ?? item.text,
      unread: current.unread ?? item.unread,
      createdAt: current.createdAt ?? item.createdAt,
    });
  }

  return [...merged.values()].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizeMessageText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function buildMessageMergeKey(item: MessageSummary): string {
  const id = (item.id?.trim() ?? "").toLowerCase();
  return [
    "msg",
    id,
    item.createdAt ?? "",
    item.from?.trim().toLowerCase() ?? "",
    item.to?.trim().toLowerCase() ?? "",
    normalizeMessageText(item.subject),
    normalizeMessageText(item.text),
  ].join("|");
}

function toBubbleText(value: string | undefined): string {
  const text = (value ?? "").trim();
  return text || "--";
}

function toPreviewText(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "--";
}

function initialsFromName(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "?";
  }
  const ascii = normalized.match(/[A-Za-z0-9]/g);
  if (ascii && ascii.length > 0) {
    return ascii.slice(0, 2).join("").toUpperCase();
  }
  const chars = [...normalized].filter((char) => !/\s/.test(char));
  return (chars.slice(0, 2).join("") || "?").toUpperCase();
}

function isSelfMessage(
  item: MessageSummary,
  usernameLower: string,
  conversationPeerLower?: string
): boolean {
  const fromLower = item.from?.trim().toLowerCase();
  const toLower = item.to?.trim().toLowerCase();

  if (conversationPeerLower) {
    if (fromLower && fromLower === conversationPeerLower && toLower !== conversationPeerLower) {
      return false;
    }
    if (toLower && toLower === conversationPeerLower && fromLower !== conversationPeerLower) {
      return true;
    }
    if (fromLower === conversationPeerLower && !toLower) {
      return false;
    }
    if (toLower === conversationPeerLower && !fromLower) {
      return true;
    }
  }

  if (usernameLower) {
    if (fromLower && fromLower === usernameLower && toLower !== usernameLower) {
      return true;
    }
    if (toLower && toLower === usernameLower && fromLower !== usernameLower) {
      return false;
    }
    if (fromLower && fromLower !== usernameLower && !toLower) {
      return false;
    }
    if (toLower && toLower !== usernameLower && !fromLower) {
      return true;
    }
  }
  if (item.folder === "sent") {
    return true;
  }
  if (item.folder === "inbox") {
    return false;
  }
  return fromLower === usernameLower;
}

function resolvePeer(
  item: MessageSummary,
  usernameLower: string,
  conversationPeerLower?: string
): string | undefined {
  const self = isSelfMessage(item, usernameLower, conversationPeerLower);
  const from = item.from?.trim();
  const to = item.to?.trim();
  if (self) {
    if (to && to !== "--" && to.toLowerCase() !== usernameLower) {
      return to;
    }
    if (from && from !== "--" && from.toLowerCase() !== usernameLower) {
      return from;
    }
  } else {
    if (from && from !== "--" && from.toLowerCase() !== usernameLower) {
      return from;
    }
    if (to && to !== "--" && to.toLowerCase() !== usernameLower) {
      return to;
    }
  }
  if (from && from !== "--") {
    return from;
  }
  if (to && to !== "--") {
    return to;
  }
  return undefined;
}

function buildConversations(
  messages: MessageSummary[],
  usernameLower: string,
  displayNameLookup: Map<string, string>
): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>();

  for (const item of messages) {
    const peer = resolvePeer(item, usernameLower);
    const key = canonicalPeerKey(peer, displayNameLookup);
    if (!peer || !key) {
      continue;
    }
    const current =
      map.get(key) ??
      ({
        key,
        peer,
        lastAtTime: 0,
        lastText: "--",
        unreadCount: 0,
        messageCount: 0,
      } satisfies ConversationSummary);

    const itemTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    current.messageCount += 1;
    if (itemTime >= current.lastAtTime) {
      current.lastAt = item.createdAt ?? current.lastAt;
      current.lastAtTime = itemTime;
      current.lastText = toPreviewText(item.text);
    }
    if (isLikelyAccountId(current.peer) && !isLikelyAccountId(peer)) {
      current.peer = peer;
    }
    if (!isSelfMessage(item, usernameLower) && item.unread) {
      current.unreadCount += 1;
    }
    if (!map.has(key)) {
      map.set(key, current);
    }
  }

  return [...map.values()].sort((left, right) => {
    const leftTime = left.lastAtTime;
    const rightTime = right.lastAtTime;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.peer.localeCompare(right.peer);
  });
}

export function MessagesPanel() {
  const { locale } = useI18n();
  const session = useAuthStore((state) => state.session);
  const isZh = locale === "zh-CN";

  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [threadMessages, setThreadMessages] = useState<MessageSummary[]>([]);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [selectedConversationKey, setSelectedConversationKey] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const [displayNameMap, setDisplayNameMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [composeText, setComposeText] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const sessionKey = session
    ? `${session.baseUrl}|${session.username}|${session.token}|${session.accountId ?? ""}`
    : "";

  const labels = useMemo(
    () =>
      isZh
        ? {
            title: "消息",
            subtitle: "按用户分组的聊天记录",
            refreshNow: "立即刷新",
            conversations: "会话",
            searchConversations: "搜索会话",
            loading: "正在加载消息...",
            noMessages: "暂无消息记录。",
            noConversations: "暂无会话。",
            noMatchedConversations: "没有匹配的会话。",
            selectConversation: "请选择左侧会话。",
            composeBody: "消息内容",
            composeTargetPrefix: "发送给",
            composePlaceholderBody: "输入消息内容...",
            send: "发送",
            sending: "发送中...",
            threadLoading: "同步聊天记录中...",
            pressEnterToSend: "Enter 发送，Shift+Enter 换行",
            you: "你",
            sendSuccess: "消息已发送。",
            noTargetToSend: "请先选择会话。",
            bodyRequired: "请输入消息内容。",
            failedToLoad: "加载消息失败",
            unknownError: "未知错误",
          }
        : {
            title: "Messages",
            subtitle: "Chat history grouped by user",
            refreshNow: "Refresh now",
            conversations: "Conversations",
            searchConversations: "Search conversations",
            loading: "Loading messages...",
            noMessages: "No message history.",
            noConversations: "No conversations.",
            noMatchedConversations: "No conversations matched.",
            selectConversation: "Select a conversation from the left.",
            composeBody: "Message",
            composeTargetPrefix: "Send to",
            composePlaceholderBody: "Enter message...",
            send: "Send",
            sending: "Sending...",
            threadLoading: "Syncing messages...",
            pressEnterToSend: "Enter to send, Shift+Enter for new line",
            you: "You",
            sendSuccess: "Message sent.",
            noTargetToSend: "Select a conversation first.",
            bodyRequired: "Message body is required.",
            failedToLoad: "Failed to load messages",
            unknownError: "Unknown error",
          },
    [isZh]
  );

  const usernameLower = session?.username.trim().toLowerCase() ?? "";

  const displayNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(displayNameMap)) {
      const normalized = normalizePeerKey(key);
      const display = value.trim();
      if (!normalized || !display) {
        continue;
      }
      map.set(normalized, display);
    }
    return map;
  }, [displayNameMap]);

  const conversations = useMemo(
    () => buildConversations(messages, usernameLower, displayNameLookup),
    [displayNameLookup, messages, usernameLower]
  );

  const resolveDisplayName = useCallback(
    (value: string | undefined): string => {
      const normalized = normalizePeerKey(value);
      const fallback = value?.trim() ?? "";
      if (!normalized) {
        return fallback || "--";
      }
      const mapped = displayNameLookup.get(normalized);
      return mapped ?? (fallback || "--");
    },
    [displayNameLookup]
  );

  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    if (!query) {
      return conversations;
    }
    return conversations.filter((item) => {
      const display = resolveDisplayName(item.peer).toLowerCase();
      const peer = item.peer.toLowerCase();
      const preview = item.lastText.toLowerCase();
      return display.includes(query) || peer.includes(query) || preview.includes(query);
    });
  }, [conversationQuery, conversations, resolveDisplayName]);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.key === selectedConversationKey),
    [conversations, selectedConversationKey]
  );

  const fallbackConversationMessages = useMemo(() => {
    if (!selectedConversation) {
      return [];
    }
    return messages.filter((item) => {
      const peer = resolvePeer(item, usernameLower);
      return canonicalPeerKey(peer, displayNameLookup) === selectedConversation.key;
    });
  }, [displayNameLookup, messages, selectedConversation, usernameLower]);

  const conversationMessages = useMemo(
    () => mergeMessages(fallbackConversationMessages, threadMessages),
    [fallbackConversationMessages, threadMessages]
  );

  const loadMessages = useCallback(async () => {
    if (!session) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [inboxPage, sentPage] = await Promise.all([
        fetchMessagesPage(session, { folder: "inbox", limit: PAGE_LIMIT }),
        fetchMessagesPage(session, { folder: "sent", limit: PAGE_LIMIT }),
      ]);
      setMessages(mergeMessages(inboxPage.items, sentPage.items));
    } catch (error) {
      const detail = error instanceof Error ? error.message : labels.unknownError;
      setErrorMessage(`${labels.failedToLoad}: ${detail}`);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, [labels.failedToLoad, labels.unknownError, session]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, sessionKey]);

  useEffect(() => {
    setSelectedConversationKey((current) => {
      if (!conversations.length) {
        return current ? "" : current;
      }
      const stillValid = conversations.some((item) => item.key === current);
      if (stillValid) {
        return current;
      }
      return conversations[0].key;
    });
  }, [conversations]);

  useEffect(() => {
    if (!session) {
      setDisplayNameMap((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }
    const ids = [
      ...new Set(
        conversations
          .flatMap((item) => [item.peer, item.key])
          .map((item) => item.trim())
          .filter((item) => item.length > 0 && isLikelyAccountId(item))
      ),
    ];
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;
    void resolveUsernamesByIds(session, ids).then((result) => {
      if (cancelled) {
        return;
      }
      setDisplayNameMap((current) => {
        let changed = false;
        const next: Record<string, string> = { ...current };
        for (const [key, value] of Object.entries(result)) {
          const normalizedKey = key.trim();
          const normalizedValue = value.trim();
          if (!normalizedKey || !normalizedValue) {
            continue;
          }
          if (next[normalizedKey] === normalizedValue) {
            continue;
          }
          next[normalizedKey] = normalizedValue;
          changed = true;
        }
        return changed ? next : current;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [conversations, session]);

  useEffect(() => {
    if (!session || !selectedConversation) {
      setThreadMessages([]);
      return;
    }
    let cancelled = false;
    setIsThreadLoading(true);
    setThreadMessages([]);
    void fetchConversationMessages(session, selectedConversation.peer, 200)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setThreadMessages(items);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setThreadMessages([]);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedConversation, session]);

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
    const element = streamRef.current;
    if (!element || isLoading || !selectedConversation) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [conversationMessages, isLoading, selectedConversation]);

  async function handleSendMessage() {
    if (!session) {
      return;
    }
    setComposeError(null);

    const to = selectedConversation ? resolveDisplayName(selectedConversation.peer) : "";
    const text = composeText.trim();
    if (!to) {
      setComposeError(labels.noTargetToSend);
      return;
    }
    if (!text) {
      setComposeError(labels.bodyRequired);
      return;
    }

    setIsSending(true);
    try {
      const feedback = await sendMessage(session, { to, text });
      setComposeText("");
      setToastMessage(feedback ?? labels.sendSuccess);
      await loadMessages();
      const key = normalizePeerKey(to);
      if (key) {
        setSelectedConversationKey(key);
      }
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : labels.unknownError);
    } finally {
      setIsSending(false);
    }
  }

  const activePeerDisplay = selectedConversation ? resolveDisplayName(selectedConversation.peer) : "--";

  return (
    <section className="panel dashboard-panel messages-panel chat-messages-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">{labels.title}</h1>
          <p className="page-subtitle">{labels.subtitle}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => void loadMessages()} type="button">
            {labels.refreshNow}
          </button>
          <span className="entity-chip">
            {labels.conversations}: {conversations.length}
          </span>
        </div>
      </header>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      <div className="chat-conversation-layout">
        <aside className="card chat-conversation-card">
          <div className="chat-sidebar-top">
            <h2 className="chat-conversation-title">{labels.conversations}</h2>
            <span className="entity-chip chat-conversation-count">
              {filteredConversations.length}/{conversations.length}
            </span>
          </div>
          <label className="chat-search-box">
            <input
              className="chat-search-input"
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.currentTarget.value)}
              placeholder={labels.searchConversations}
              type="search"
            />
          </label>
          {isLoading ? (
            <p className="messages-loading">{labels.loading}</p>
          ) : conversations.length === 0 ? (
            <p className="hint-text chat-empty">{labels.noConversations}</p>
          ) : filteredConversations.length === 0 ? (
            <p className="hint-text chat-empty">{labels.noMatchedConversations}</p>
          ) : (
            <div className="chat-conversation-scroll">
              <div className="chat-conversation-list">
                {filteredConversations.map((conversation) => {
                  const displayName = resolveDisplayName(conversation.peer);
                  return (
                    <button
                      key={conversation.key}
                      className={
                        conversation.key === selectedConversationKey
                          ? "chat-conversation-item active"
                          : "chat-conversation-item"
                      }
                      onClick={() => setSelectedConversationKey(conversation.key)}
                      type="button"
                    >
                      <span className="chat-conversation-avatar">{initialsFromName(displayName)}</span>
                      <span className="chat-conversation-content">
                        <span className="chat-conversation-top">
                          <strong>{displayName}</strong>
                          <time>{formatConversationTime(conversation.lastAt, locale)}</time>
                        </span>
                        <span className="chat-conversation-preview">{conversation.lastText}</span>
                        <span className="chat-conversation-meta">
                          <span>{conversation.messageCount}</span>
                          {conversation.unreadCount > 0 ? (
                            <span className="chat-conversation-unread">{conversation.unreadCount}</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <article className="card chat-thread-shell">
          <header className="chat-thread-header">
            {selectedConversation ? (
              <>
                <span className="chat-thread-avatar">{initialsFromName(activePeerDisplay)}</span>
                <div className="chat-thread-info">
                  <strong>{activePeerDisplay}</strong>
                  <span>{selectedConversation.peer}</span>
                </div>
                <span className="entity-chip chat-thread-size">{conversationMessages.length}</span>
              </>
            ) : (
              <p className="hint-text chat-empty">{labels.selectConversation}</p>
            )}
          </header>

          <div className="chat-stream-scroll" ref={streamRef}>
            {isLoading ? (
              <p className="messages-loading">{labels.loading}</p>
            ) : !selectedConversation ? (
              <p className="hint-text chat-empty">{labels.selectConversation}</p>
            ) : conversationMessages.length === 0 ? (
              <p className="hint-text chat-empty">{labels.noMessages}</p>
            ) : (
              <div className="chat-history">
                {conversationMessages.map((item) => {
                  const selectedPeerLower = selectedConversation.peer.trim().toLowerCase();
                  const self = isSelfMessage(item, usernameLower, selectedPeerLower);
                  const peer = resolvePeer(item, usernameLower, selectedPeerLower) ?? selectedConversation.peer;
                  const displayPeer = self ? labels.you : resolveDisplayName(peer);
                  return (
                    <div className={self ? "chat-row self" : "chat-row peer"} key={item.id}>
                      <div className="chat-bubble">
                        <div className="chat-bubble-meta">
                          <span>{displayPeer}</span>
                          <time>{formatDateTime(item.createdAt)}</time>
                        </div>
                        <p className="chat-bubble-text">{toBubbleText(item.text)}</p>
                      </div>
                    </div>
                  );
                })}
                {isThreadLoading ? <p className="messages-loading chat-thread-loading">{labels.threadLoading}</p> : null}
              </div>
            )}
          </div>

          <footer className="chat-compose-panel">
            <div className="chat-compose-topline">
              <span>
                {labels.composeTargetPrefix}: {selectedConversation ? activePeerDisplay : "--"}
              </span>
              <span>{labels.pressEnterToSend}</span>
            </div>

            <textarea
              className="chat-compose-input"
              value={composeText}
              onChange={(event) => setComposeText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isSending) {
                    void handleSendMessage();
                  }
                }
              }}
              placeholder={`${labels.composeBody}: ${labels.composePlaceholderBody}`}
              rows={3}
              disabled={!selectedConversation || isSending}
            />
            <div className="chat-compose-actions">
              {composeError ? <p className="error-text chat-compose-error">{composeError}</p> : <span />}
              <button
                className="secondary-button"
                onClick={() => void handleSendMessage()}
                type="button"
                disabled={isSending || !selectedConversation}
              >
                {isSending ? labels.sending : labels.send}
              </button>
            </div>
          </footer>
        </article>
      </div>

      {toastMessage ? <div className="market-toast">{toastMessage}</div> : null}
    </section>
  );
}
