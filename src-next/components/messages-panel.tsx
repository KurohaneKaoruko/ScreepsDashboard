"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchConversationThread, fetchProcessedMessages, sendMessage } from "../lib/screeps/messages";
import { normalizeBaseUrl } from "../lib/screeps/request";
import type {
  ProcessedConversation,
  ProcessedConversationMap,
  ProcessedConversationMessage,
} from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";

const TOAST_DURATION_MS = 2200;
const PER_CONVERSATION_LIMIT = 200;
const MAX_CONVERSATIONS = 200;

function toErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "cause", "details"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    try {
      const serialized = JSON.stringify(record);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // ignore serialization failure
    }
  }
  return fallback;
}

interface ConversationView {
  key: string;
  conversation: ProcessedConversation;
  lastAt?: string;
  lastAtSort: number;
  lastText: string;
  unreadCount: number;
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  const asNumber = Number(value);
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
}

function formatConversationTime(value: string | undefined, locale: string): string {
  if (!value) {
    return "--";
  }
  const asNumber = Number(value);
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value);
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

function toSortTime(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return 0;
}

function toPreviewText(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "--";
}

function toBubbleText(value: string | undefined): string {
  const text = (value ?? "").trim();
  return text || "--";
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

function normalizeAvatarBase(baseUrl: string): string {
  const input = baseUrl.trim();
  if (!input) {
    return "https://screeps.com";
  }
  try {
    return normalizeBaseUrl(input);
  } catch {
    return "https://screeps.com";
  }
}

function normalizeAvatarCandidate(baseUrl: string, value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const normalizedBase = normalizeAvatarBase(baseUrl);
  if (trimmed.startsWith("/")) {
    return `${normalizedBase}${trimmed}`;
  }
  return `${normalizedBase}/${trimmed.replace(/^\/+/, "")}`;
}

function buildAvatarCandidates(
  baseUrl: string,
  username: string,
  preferredAvatarUrl?: string,
  hasBadge?: boolean
): string[] {
  const normalizedUsername = username.trim();
  const normalizedBase = normalizeAvatarBase(baseUrl);
  const candidates = [
    normalizeAvatarCandidate(baseUrl, preferredAvatarUrl),
    normalizedUsername
      ? `${normalizedBase}/api/user/avatar?username=${encodeURIComponent(normalizedUsername)}`
      : undefined,
    normalizedUsername && hasBadge
      ? `${normalizedBase}/api/user/badge-svg?username=${encodeURIComponent(normalizedUsername)}`
      : undefined,
    normalizedUsername && hasBadge
      ? `${normalizedBase}/api/user/badge-svg?username=${encodeURIComponent(normalizedUsername)}&border=1`
      : undefined,
  ];
  const unique = new Set<string>();
  for (const item of candidates) {
    if (item) {
      unique.add(item);
    }
  }
  return [...unique];
}

interface ChatAvatarProps {
  className: string;
  baseUrl: string;
  username: string;
  preferredAvatarUrl?: string;
  hasBadge?: boolean;
  fallback: string;
}

function ChatAvatar({
  className,
  baseUrl,
  username,
  preferredAvatarUrl,
  hasBadge,
  fallback,
}: ChatAvatarProps) {
  const candidates = useMemo(
    () => buildAvatarCandidates(baseUrl, username, preferredAvatarUrl, hasBadge),
    [baseUrl, hasBadge, preferredAvatarUrl, username]
  );
  const [avatarIndex, setAvatarIndex] = useState(0);
  const candidatesKey = candidates.join("|");

  useEffect(() => {
    setAvatarIndex(0);
  }, [candidatesKey]);

  const avatarSrc = avatarIndex < candidates.length ? candidates[avatarIndex] : undefined;
  return (
    <span className={className}>
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=""
          className="chat-avatar-img"
          loading="lazy"
          onError={() => setAvatarIndex((index) => index + 1)}
        />
      ) : (
        <span className="chat-avatar-fallback">{fallback}</span>
      )}
    </span>
  );
}

function buildMessageRenderKey(message: ProcessedConversationMessage, index: number): string {
  return `${message.id}|${message.createdAt ?? "--"}|${index}`;
}

function toTargetRespondent(conversation: ProcessedConversation | undefined): string {
  if (!conversation) {
    return "";
  }
  const rawPeerId = conversation.peerId.trim();
  if (!rawPeerId || rawPeerId === "--") {
    return "";
  }
  const normalizedPeerId = rawPeerId.startsWith("name:") ? rawPeerId.slice(5) : rawPeerId;
  if (!/^[0-9a-f]{24}$/i.test(normalizedPeerId)) {
    return "";
  }
  return normalizedPeerId;
}

export function MessagesPanel() {
  const { locale } = useI18n();
  const session = useAuthStore((state) => state.session);
  const isZh = locale === "zh-CN";
  const isGuestSession = Boolean(session && !session.token.trim());
  const guestHint = isZh
    ? "游客模式下无法查看消息，请登录可用 Token 的账号。"
    : "Messages are unavailable in guest mode. Please sign in with a token account.";

  const [conversationsMap, setConversationsMap] = useState<ProcessedConversationMap>({});
  const [threadMessagesByPeer, setThreadMessagesByPeer] = useState<Record<string, ProcessedConversationMessage[]>>({});
  const [threadLoadingPeer, setThreadLoadingPeer] = useState<string | null>(null);
  const [selectedConversationKey, setSelectedConversationKey] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [composeText, setComposeText] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");

  const streamRef = useRef<HTMLDivElement | null>(null);
  const sessionKey = session
    ? `${session.baseUrl}|${session.username}|${session.token}|${session.accountId ?? ""}`
    : "";

  const labels = useMemo(
    () =>
      isZh
        ? {
            title: "消息",
            subtitle: "由后端聚合后的会话消息",
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
            threadLoading: "正在加载会话历史...",
            pressEnterToSend: "Enter 发送，Shift+Enter 换行",
            you: "你",
            sendSuccess: "消息已发送。",
            noTargetToSend: "请先选择会话。",
            bodyRequired: "请输入消息内容。",
            failedToLoad: "加载消息失败",
            unknownError: "未知错误",
            backToConversations: "返回",
          }
        : {
            title: "Messages",
            subtitle: "Backend-processed conversation messages",
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
            threadLoading: "Loading conversation history...",
            pressEnterToSend: "Enter to send, Shift+Enter for new line",
            you: "You",
            sendSuccess: "Message sent.",
            noTargetToSend: "Select a conversation first.",
            bodyRequired: "Message body is required.",
            failedToLoad: "Failed to load messages",
            unknownError: "Unknown error",
            backToConversations: "Back",
          },
    [isZh]
  );

  const loadMessages = useCallback(async () => {
    if (!session || isGuestSession) {
      setConversationsMap({});
      setThreadMessagesByPeer({});
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const raw = await fetchProcessedMessages(session, {
        maxConversations: MAX_CONVERSATIONS,
      });
      setConversationsMap(raw);
      setThreadMessagesByPeer((current) => {
        const next: Record<string, ProcessedConversationMessage[]> = {};
        for (const key of Object.keys(raw)) {
          if (current[key]) {
            next[key] = current[key];
          }
        }
        return next;
      });
    } catch (error) {
      const detail = toErrorDetail(error, labels.unknownError);
      setErrorMessage(`${labels.failedToLoad}: ${detail}`);
      setConversationsMap({});
    } finally {
      setIsLoading(false);
    }
  }, [isGuestSession, labels.failedToLoad, labels.unknownError, session]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, sessionKey]);

  const loadConversationThread = useCallback(
    async (peerId: string, peerUsername: string, peerAvatarUrl?: string, peerHasBadge?: boolean) => {
      if (!session || isGuestSession) {
        return;
      }
      setThreadLoadingPeer(peerId);
      try {
        const conversation = await fetchConversationThread(session, {
          peerId,
          peerUsername,
          peerAvatarUrl,
          peerHasBadge,
          limit: PER_CONVERSATION_LIMIT,
        });
        setThreadMessagesByPeer((current) => ({
          ...current,
          [peerId]: conversation.messages,
        }));
        setConversationsMap((current) => {
          const existing = current[peerId];
          if (!existing) {
            return current;
          }
          const latest = conversation.messages[conversation.messages.length - 1];
          return {
            ...current,
            [peerId]: {
              ...existing,
              peerUsername: conversation.peerUsername,
              peerAvatarUrl: conversation.peerAvatarUrl ?? existing.peerAvatarUrl,
              peerHasBadge: conversation.peerHasBadge ?? existing.peerHasBadge,
              messages: latest ? [latest] : existing.messages,
            },
          };
        });
      } catch (error) {
        const detail = toErrorDetail(error, labels.unknownError);
        setErrorMessage(`${labels.failedToLoad}: ${detail}`);
      } finally {
        setThreadLoadingPeer((current) => (current === peerId ? null : current));
      }
    },
    [isGuestSession, labels.failedToLoad, labels.unknownError, session]
  );

  const appendLocalOutboundMessage = useCallback(
    (conversation: ProcessedConversation, text: string) => {
      if (!session || isGuestSession) {
        return;
      }
      const createdAt = new Date().toISOString();
      const id = `local:${conversation.peerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const localMessage: ProcessedConversationMessage = {
        id,
        createdAt,
        text,
        sender: {
          id: session.userId?.trim() || session.username,
          username: session.username,
          isSelf: true,
        },
        recipient: {
          id: conversation.peerId,
          username: conversation.peerUsername,
          isSelf: false,
        },
        direction: "outbound",
        unread: false,
      };

      setThreadMessagesByPeer((current) => {
        const existing = current[conversation.peerId] ?? conversation.messages;
        return {
          ...current,
          [conversation.peerId]: [...existing, localMessage],
        };
      });

      setConversationsMap((current) => {
        const existing = current[conversation.peerId] ?? conversation;
        return {
          ...current,
          [conversation.peerId]: {
            ...existing,
            messages: [localMessage],
          },
        };
      });
    },
    [isGuestSession, session]
  );

  const conversations = useMemo<ConversationView[]>(() => {
    return Object.entries(conversationsMap)
      .map(([key, conversation]) => {
        const messages = threadMessagesByPeer[key] ?? conversation.messages;
        const lastMessage = messages[messages.length - 1];
        const lastAt = lastMessage?.createdAt;
        return {
          key,
          conversation,
          lastAt,
          lastAtSort: toSortTime(lastAt),
          lastText: toPreviewText(lastMessage?.text),
          unreadCount: messages.filter((item) => !item.sender.isSelf && item.unread).length,
        };
      })
      .sort((left, right) => {
        if (left.lastAtSort !== right.lastAtSort) {
          return right.lastAtSort - left.lastAtSort;
        }
        return left.conversation.peerUsername.localeCompare(right.conversation.peerUsername);
      });
  }, [conversationsMap, threadMessagesByPeer]);

  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    if (!query) {
      return conversations;
    }
    return conversations.filter((item) => {
      const username = item.conversation.peerUsername.toLowerCase();
      const peerId = item.conversation.peerId.toLowerCase();
      const preview = item.lastText.toLowerCase();
      return username.includes(query) || peerId.includes(query) || preview.includes(query);
    });
  }, [conversationQuery, conversations]);

  useEffect(() => {
    setSelectedConversationKey((current) => {
      if (conversations.length === 0) {
        return "";
      }
      if (conversations.some((item) => item.key === current)) {
        return current;
      }
      return conversations[0].key;
    });
  }, [conversations]);

  useEffect(() => {
    if (!selectedConversationKey) {
      setMobilePane("list");
    }
  }, [selectedConversationKey]);

  const selectedConversation = useMemo(
    () => conversationsMap[selectedConversationKey],
    [conversationsMap, selectedConversationKey]
  );

  const selectedPeerId = selectedConversation?.peerId ?? "";
  const selectedPeerUsername = selectedConversation?.peerUsername ?? "";
  const selectedPeerAvatarUrl = selectedConversation?.peerAvatarUrl;
  const selectedPeerHasBadge = selectedConversation?.peerHasBadge;
  const loadedThreadMessages = selectedPeerId ? threadMessagesByPeer[selectedPeerId] : undefined;
  const conversationMessages = loadedThreadMessages ?? selectedConversation?.messages ?? [];
  const isThreadLoading = selectedPeerId.length > 0 && threadLoadingPeer === selectedPeerId;
  const activePeerDisplay = selectedConversation ? selectedConversation.peerUsername : "--";

  useEffect(() => {
    if (!selectedPeerId || !session || isGuestSession) {
      return;
    }
    void loadConversationThread(selectedPeerId, selectedPeerUsername, selectedPeerAvatarUrl, selectedPeerHasBadge);
  }, [
    loadConversationThread,
    selectedPeerAvatarUrl,
    selectedPeerHasBadge,
    selectedPeerId,
    selectedPeerUsername,
    isGuestSession,
    session,
    sessionKey,
  ]);

  useEffect(() => {
    const element = streamRef.current;
    if (!element || isLoading || !selectedConversation) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [conversationMessages.length, isLoading, selectedConversation]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = window.setTimeout(() => setToastMessage(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  async function handleSendMessage() {
    if (!session || isGuestSession) {
      return;
    }
    setComposeError(null);

    const to = toTargetRespondent(selectedConversation);
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
      if (selectedConversation) {
        appendLocalOutboundMessage(selectedConversation, text);
        void loadConversationThread(
          selectedConversation.peerId,
          selectedConversation.peerUsername,
          selectedConversation.peerAvatarUrl,
          selectedConversation.peerHasBadge
        );
      }
    } catch (error) {
      setComposeError(toErrorDetail(error, labels.unknownError));
    } finally {
      setIsSending(false);
    }
  }

  function handleOpenConversation(conversationKey: string) {
    setSelectedConversationKey(conversationKey);
    setMobilePane("thread");
  }

  function handleBackToConversations() {
    setMobilePane("list");
  }

  if (isGuestSession) {
    return (
      <section className="panel dashboard-panel messages-panel chat-messages-panel">
        <header className="dashboard-header">
          <div>
            <h1 className="page-title">{labels.title}</h1>
            <p className="page-subtitle">{labels.subtitle}</p>
          </div>
        </header>
        <article className="card">
          <p className="hint-text">{guestHint}</p>
        </article>
      </section>
    );
  }

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
        </div>
      </header>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      <div className={`chat-conversation-layout mobile-${mobilePane}`}>
        <aside className="card chat-conversation-card">
          <div className="chat-sidebar-top">
            <h2 className="chat-conversation-title">{labels.conversations}</h2>
            <span className="entity-chip chat-conversation-count">
              {filteredConversations.length}/{conversations.length}
            </span>
          </div>
          <input
            className="chat-search-input"
            value={conversationQuery}
            onChange={(event) => setConversationQuery(event.currentTarget.value)}
            placeholder={labels.searchConversations}
            type="search"
          />
          {isLoading ? (
            <p className="messages-loading">{labels.loading}</p>
          ) : conversations.length === 0 ? (
            <p className="hint-text chat-empty">{labels.noConversations}</p>
          ) : filteredConversations.length === 0 ? (
            <p className="hint-text chat-empty">{labels.noMatchedConversations}</p>
          ) : (
            <div className="chat-conversation-list">
              {filteredConversations.map((conversation) => {
                const displayName = conversation.conversation.peerUsername || conversation.conversation.peerId;
                return (
                  <button
                    key={conversation.key}
                    className={
                      conversation.key === selectedConversationKey
                        ? "chat-conversation-item active"
                        : "chat-conversation-item"
                    }
                    onClick={() => handleOpenConversation(conversation.key)}
                    type="button"
                  >
                    <ChatAvatar
                      className="chat-conversation-avatar"
                      baseUrl={session?.baseUrl ?? ""}
                      username={displayName}
                      preferredAvatarUrl={conversation.conversation.peerAvatarUrl}
                      hasBadge={conversation.conversation.peerHasBadge}
                      fallback={initialsFromName(displayName)}
                    />
                    <span className="chat-conversation-content">
                      <span className="chat-conversation-top">
                        <strong>{displayName}</strong>
                        <time>{formatConversationTime(conversation.lastAt, locale)}</time>
                      </span>
                      <span className="chat-conversation-preview">{conversation.lastText}</span>
                      {conversation.unreadCount > 0 ? (
                        <span className="chat-conversation-unread">{conversation.unreadCount}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
        <article className="card chat-thread-shell">
          <header className="chat-thread-header">
            <button className="ghost-button chat-thread-back" onClick={handleBackToConversations} type="button">
              {labels.backToConversations}
            </button>
            {selectedConversation ? (
              <>
                <ChatAvatar
                  className="chat-thread-avatar"
                  baseUrl={session?.baseUrl ?? ""}
                  username={activePeerDisplay}
                  preferredAvatarUrl={selectedConversation.peerAvatarUrl}
                  hasBadge={selectedConversation.peerHasBadge}
                  fallback={initialsFromName(activePeerDisplay)}
                />
                <div className="chat-thread-info">
                  <strong>{activePeerDisplay}</strong>
                  <span>{selectedConversation.peerId}</span>
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
            ) : isThreadLoading && !loadedThreadMessages ? (
              <p className="messages-loading">{labels.threadLoading}</p>
            ) : conversationMessages.length === 0 ? (
              <p className="hint-text chat-empty">{labels.noMessages}</p>
            ) : (
              <div className="chat-history">
                {conversationMessages.map((item, index) => {
                  const self = item.sender.isSelf;
                  const displayPeer = self ? labels.you : item.sender.username;
                  return (
                    <div className={self ? "chat-row self" : "chat-row peer"} key={buildMessageRenderKey(item, index)}>
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
