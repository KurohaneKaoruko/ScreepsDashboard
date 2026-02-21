import { sendConsoleCommand as sendConsoleCommandByApi } from "./market";
import type { ScreepsRealtimeEvent } from "./realtime-client";
import type {
  ConsoleExecutionResult,
  ConsoleStreamKind,
  ConsoleStreamRecord,
  ScreepsSession,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function toDebugText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" && serialized !== "[]" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const lines = value
      .map((item) => extractText(item))
      .filter((item): item is string => Boolean(item));
    return sanitizeText(lines.join("\n"));
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const direct = sanitizeText(
    firstString([
      record.output,
      record.stdout,
      record.stderr,
      record.result,
      record.message,
      record.text,
      record.status,
      asRecord(record.data)?.message,
      asRecord(record.data)?.text,
      asRecord(record.data)?.output,
    ])
  );
  if (direct) {
    return direct;
  }

  const nestedCandidates = [record.log, record.logs, record.lines, record.data, record.payload];
  for (const candidate of nestedCandidates) {
    const nestedText = extractText(candidate);
    if (nestedText) {
      return nestedText;
    }
  }

  return toDebugText(record);
}

function inferKind(channel: string, payload: unknown): ConsoleStreamKind {
  const normalizedChannel = channel.trim().toLowerCase();
  const textLower = extractText(payload)?.toLowerCase();

  if (
    normalizedChannel.includes("error") ||
    normalizedChannel === "__error" ||
    normalizedChannel.includes("exception") ||
    textLower?.includes("error") ||
    textLower?.includes("exception")
  ) {
    return "error";
  }
  if (
    normalizedChannel === "__state" ||
    normalizedChannel === "auth" ||
    normalizedChannel.startsWith("__")
  ) {
    return "system";
  }
  return "stdout";
}

function buildRecordId(event: ScreepsRealtimeEvent): string {
  const rawPart = event.raw.trim().slice(0, 48).replace(/\s+/g, "_");
  return `${event.receivedAt}:${event.channel}:${rawPart}`;
}

export function buildConsoleRealtimeChannels(
  username: string,
  userId?: string
): string[] {
  const normalizedUsername = username.trim();
  const normalizedUserId = userId?.trim();
  const identities = new Set<string>();
  if (normalizedUsername) {
    identities.add(normalizedUsername);
  }
  if (normalizedUserId) {
    identities.add(normalizedUserId);
  }

  const channels = new Set<string>([
    "console",
    "message",
    "user/console",
    "user:console",
    "server-message",
  ]);

  for (const identity of identities) {
    channels.add(`user:${identity}/console`);
    channels.add(`user/${identity}/console`);
    channels.add(`user:${identity}/messages`);
    channels.add(`user/${identity}/messages`);
  }

  return [...channels];
}

export function normalizeConsoleStreamEvent(
  event: ScreepsRealtimeEvent
): ConsoleStreamRecord | null {
  if (event.channel === "__state") {
    const state = firstString([asRecord(event.payload)?.state]) ?? "unknown";
    return {
      id: buildRecordId(event),
      channel: event.channel,
      text: `state: ${state}`,
      receivedAt: event.receivedAt,
      kind: "system",
    };
  }

  const text = extractText(event.payload) ?? sanitizeText(event.raw);
  if (!text) {
    return null;
  }

  return {
    id: buildRecordId(event),
    channel: event.channel,
    text,
    receivedAt: event.receivedAt,
    kind: inferKind(event.channel, event.payload),
  };
}

export async function sendConsoleCommand(
  session: ScreepsSession,
  code: string,
  shardInput?: string
): Promise<ConsoleExecutionResult> {
  const feedback = await sendConsoleCommandByApi(session, code, shardInput);
  return {
    feedback,
    raw: code,
    executedAt: new Date().toISOString(),
  };
}
