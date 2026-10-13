import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "../runtime/platform";
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

interface ScreepsMessagesSendInvokeRequest {
  baseUrl: string;
  token: string;
  username: string;
  respondent: string;
  subject?: string;
  text: string;
}

interface ScreepsMessagesSendInvokeResponse {
  ok: boolean;
  feedback?: string;
}

function extractInvokeErrorMessage(error: unknown): string {
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
  return "Request failed";
}

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    throw new Error(extractInvokeErrorMessage(error));
  }
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

  const result = await tauriInvoke<ProcessedConversationMap>("screeps_messages_fetch", { request });
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

  return tauriInvoke<ProcessedConversation>("screeps_messages_fetch_thread", { request });
}

export async function sendMessage(
  session: ScreepsSession,
  input: SendMessageInput
): Promise<string | undefined> {
  if (!hasTauriRuntime()) {
    throw new Error("Messaging is only available in Tauri runtime.");
  }
  const respondent = input.to.trim();
  const subject = (input.subject ?? "").trim();
  const text = input.text.trim();

  if (!respondent) {
    throw new Error("Message recipient is required.");
  }
  if (!text) {
    throw new Error("Message body cannot be empty.");
  }

  const request: ScreepsMessagesSendInvokeRequest = {
    baseUrl: session.baseUrl,
    token: session.token,
    username: session.username,
    respondent,
    subject,
    text,
  };
  const response = await tauriInvoke<ScreepsMessagesSendInvokeResponse>("screeps_messages_send", {
    request,
  });
  return response.feedback;
}
