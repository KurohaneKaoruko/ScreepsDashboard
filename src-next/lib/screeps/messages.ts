import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "../runtime/platform";
import { screepsRequest } from "./request";
import type {
  ProcessedConversation,
  ProcessedConversationMap,
  ScreepsSession,
  SendMessageInput,
} from "./types";

interface ScreepsMessagesFetchInvokeRequest {
  baseUrl: string;
  token: string;
  username: string;
  maxConversations?: number;
}

interface ScreepsMessagesThreadInvokeRequest {
  baseUrl: string;
  token: string;
  username: string;
  peerId: string;
  peerUsername?: string;
  peerAvatarUrl?: string;
  peerHasBadge?: boolean;
  limit?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractResponseError(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }
  return (
    asNonEmptyString(record.error) ??
    asNonEmptyString(record.err) ??
    (record.ok === 0 || record.ok === false ? asNonEmptyString(record.message) : undefined)
  );
}

function extractSendFeedback(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }
  const text =
    asNonEmptyString(record.message) ??
    asNonEmptyString(record.result) ??
    asNonEmptyString(record.status) ??
    asNonEmptyString(record.text);
  if (!text) {
    return undefined;
  }
  if (text === "1" || /^ok$/i.test(text)) {
    return undefined;
  }
  return text;
}

export async function fetchProcessedMessages(
  session: ScreepsSession,
  options?: { maxConversations?: number }
): Promise<ProcessedConversationMap> {
  if (!hasTauriRuntime()) {
    throw new Error("Processed messages are only available in Tauri runtime.");
  }

  const request: ScreepsMessagesFetchInvokeRequest = {
    baseUrl: session.baseUrl,
    token: session.token,
    username: session.username,
    maxConversations: options?.maxConversations,
  };

  const result = await invoke<ProcessedConversationMap>("screeps_messages_fetch", { request });
  return result ?? {};
}

export async function fetchConversationThread(
  session: ScreepsSession,
  input: { peerId: string; peerUsername?: string; peerAvatarUrl?: string; peerHasBadge?: boolean; limit?: number }
): Promise<ProcessedConversation> {
  if (!hasTauriRuntime()) {
    throw new Error("Processed messages are only available in Tauri runtime.");
  }
  const peerId = input.peerId.trim();
  if (!peerId) {
    throw new Error("Peer id is required.");
  }

  const request: ScreepsMessagesThreadInvokeRequest = {
    baseUrl: session.baseUrl,
    token: session.token,
    username: session.username,
    peerId,
    peerUsername: input.peerUsername?.trim() || undefined,
    peerAvatarUrl: input.peerAvatarUrl?.trim() || undefined,
    peerHasBadge: input.peerHasBadge,
    limit: input.limit,
  };

  return invoke<ProcessedConversation>("screeps_messages_fetch_thread", { request });
}

export async function sendMessage(
  session: ScreepsSession,
  input: SendMessageInput
): Promise<string | undefined> {
  const respondent = input.to.trim();
  const subject = (input.subject ?? "").trim();
  const text = input.text.trim();

  if (!respondent) {
    throw new Error("Message recipient is required.");
  }
  if (!text) {
    throw new Error("Message body cannot be empty.");
  }

  const response = await screepsRequest({
    baseUrl: session.baseUrl,
    endpoint: "/api/user/messages/send",
    method: "POST",
    body: { respondent, subject, text },
    token: session.token,
    username: session.username,
  });

  if (!response.ok) {
    throw new Error(`Failed to send message: HTTP ${response.status}`);
  }

  const payloadError = extractResponseError(response.data);
  if (payloadError) {
    throw new Error(`Failed to send message: ${payloadError}`);
  }
  return extractSendFeedback(response.data);
}
