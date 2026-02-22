import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "../runtime/platform";
import { normalizeBaseUrl, screepsRequest } from "./request";
import type { ScreepsRealtimeEvent } from "./realtime-client";
import type {
  ConsoleExecutionResult,
  ConsoleStreamKind,
  ConsoleStreamRecord,
  ScreepsResponse,
  ScreepsSession,
} from "./types";

const CONSOLE_LOCAL_STATE_VERSION = 1;
const CONSOLE_HISTORY_LIMIT = 100;
const CONSOLE_FAVORITES_LIMIT = 30;
const SHARD_TOKEN_PATTERN = /\bshard\d+\b/i;
const HEX_TOKEN_PATTERN = /^[0-9a-f-]{16,}$/i;
const CONSOLE_FEEDBACK_KEYS = [
  "result",
  "results",
  "output",
  "stdout",
  "message",
  "text",
  "status",
  "messages",
  "errors",
  "error",
  "log",
  "logs",
  "lines",
  "data",
  "payload",
] as const;

export interface ConsoleFavorite {
  code: string;
  updatedAt: string;
}

export interface ConsoleLocalState {
  draft: string;
  history: string[];
  favorites: ConsoleFavorite[];
}

const DEFAULT_CONSOLE_LOCAL_STATE: ConsoleLocalState = {
  draft: "",
  history: [],
  favorites: [],
};

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

function isEmptyConsoleContainer(value: unknown, depth = 0): boolean {
  if (depth > 6) {
    return false;
  }
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isEmptyConsoleContainer(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return true;
  }
  return entries.every(([, item]) => isEmptyConsoleContainer(item, depth + 1));
}

function isEmptyConsoleRealtimePayload(payload: unknown): boolean {
  const root = asRecord(payload);
  if (!root) {
    return false;
  }
  const candidate = asRecord(root.data) ?? asRecord(root.payload) ?? root;
  const hasConsoleEnvelope =
    "log" in candidate ||
    "logs" in candidate ||
    "results" in candidate ||
    "result" in candidate ||
    "messages" in candidate ||
    "errors" in candidate ||
    "error" in candidate;
  if (!hasConsoleEnvelope) {
    return false;
  }

  const directText = sanitizeText(
    firstString([
      candidate.output,
      candidate.stdout,
      candidate.stderr,
      candidate.message,
      candidate.text,
    ])
  );
  if (directText) {
    return false;
  }

  if (
    !isEmptyConsoleContainer(candidate.log) ||
    !isEmptyConsoleContainer(candidate.logs) ||
    !isEmptyConsoleContainer(candidate.results) ||
    !isEmptyConsoleContainer(candidate.result) ||
    !isEmptyConsoleContainer(candidate.messages) ||
    !isEmptyConsoleContainer(candidate.errors) ||
    !isEmptyConsoleContainer(candidate.error)
  ) {
    return false;
  }

  for (const [key, value] of Object.entries(candidate)) {
    if (
      key === "log" ||
      key === "logs" ||
      key === "results" ||
      key === "result" ||
      key === "messages" ||
      key === "errors" ||
      key === "error" ||
      key === "output" ||
      key === "stdout" ||
      key === "stderr" ||
      key === "message" ||
      key === "text" ||
      key === "shard" ||
      key === "shardName" ||
      key === "_shard" ||
      key === "time" ||
      key === "tick" ||
      key === "t"
    ) {
      continue;
    }
    if (!isEmptyConsoleContainer(value)) {
      return false;
    }
  }

  return true;
}

function normalizeCommandList(values: unknown[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
    if (output.length >= CONSOLE_HISTORY_LIMIT) {
      break;
    }
  }
  return output;
}

function normalizeFavoriteList(values: unknown[]): ConsoleFavorite[] {
  const output: ConsoleFavorite[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }
    const code = sanitizeText(typeof record.code === "string" ? record.code : undefined);
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    const updatedAt =
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : new Date(0).toISOString();
    output.push({ code, updatedAt });
    if (output.length >= CONSOLE_FAVORITES_LIMIT) {
      break;
    }
  }
  return output;
}

function normalizeShard(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const shard = value.trim().toLowerCase();
  if (!shard || !/^shard\d+$/i.test(shard)) {
    return undefined;
  }
  return shard;
}

function isOpaqueToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  if (!HEX_TOKEN_PATTERN.test(trimmed)) {
    return false;
  }
  const hexLength = trimmed.replace(/-/g, "").length;
  return hexLength >= 16;
}

function normalizeShardLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.toLowerCase().match(SHARD_TOKEN_PATTERN);
  return match ? match[0] : undefined;
}

function inferShardFromPayload(payload: unknown): string | undefined {
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || current === undefined) {
      continue;
    }
    if (typeof current === "string") {
      const shardFromText = normalizeShardLabel(current);
      if (shardFromText) {
        return shardFromText;
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const value of current) {
        queue.push(value);
      }
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      continue;
    }

    const directShard = normalizeShardLabel(
      firstString([
        record.shard,
        record.shardName,
        record._shard,
        asRecord(record.data)?.shard,
        asRecord(record.data)?.shardName,
        asRecord(record.payload)?.shard,
        asRecord(record.payload)?.shardName,
      ])
    );
    if (directShard) {
      return directShard;
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }
  return undefined;
}

function inferShard(channel: string, payload: unknown): string | undefined {
  return inferShardFromPayload(payload) ?? normalizeShardLabel(channel);
}

function extractErrorMessage(payload: unknown): string | undefined {
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const value of current) {
        queue.push(value);
      }
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      continue;
    }

    const errorText = firstString([record.error, record.message, record.text]);
    if (errorText) {
      return errorText;
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return undefined;
}

function extractPayloadError(payload: unknown): string | undefined {
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const value of current) {
        queue.push(value);
      }
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      continue;
    }

    const explicit = firstString([record.error, record.err, record.errorMessage]);
    if (explicit) {
      return explicit;
    }

    const okRaw = record.ok;
    const okValue =
      typeof okRaw === "number"
        ? okRaw
        : typeof okRaw === "string" && okRaw.trim()
          ? Number(okRaw)
          : undefined;
    if (okValue === 0) {
      const fallback = firstString([record.message, record.text]);
      return fallback ?? "Unknown error";
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return undefined;
}

function sanitizeConsoleFeedback(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "1" || /^ok$/i.test(trimmed)) {
    return undefined;
  }
  if (/^ok\s+[0-9a-f-]{16,}$/i.test(trimmed)) {
    return undefined;
  }
  if (isOpaqueToken(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function extractConsoleFeedbackFromValue(payload: unknown, depth = 0): string | undefined {
  if (depth > 6 || payload === null || payload === undefined) {
    return undefined;
  }

  if (typeof payload === "string") {
    return sanitizeConsoleFeedback(payload);
  }

  if (Array.isArray(payload)) {
    const joined = sanitizeConsoleFeedback(
      payload
        .filter((item) => typeof item === "string")
        .map((item) => (item as string).trim())
        .filter((item) => item.length > 0)
        .join("\n")
    );
    if (joined) {
      return joined;
    }
    for (const value of payload) {
      const nested = extractConsoleFeedbackFromValue(value, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const directFeedback = sanitizeConsoleFeedback(
    firstString([
      record.result,
      record.output,
      record.stdout,
      record.message,
      record.text,
      record.status,
    ])
  );
  if (directFeedback) {
    return directFeedback;
  }

  for (const key of CONSOLE_FEEDBACK_KEYS) {
    if (!(key in record)) {
      continue;
    }
    const nested = extractConsoleFeedbackFromValue(record[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function extractConsoleFeedback(payload: unknown): string | undefined {
  return extractConsoleFeedbackFromValue(payload);
}

function toErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Request failed";
}

async function sendConsoleCommandByRequest(
  session: ScreepsSession,
  code: string,
  shardInput?: string
): Promise<string | undefined> {
  const shard = normalizeShard(shardInput);
  const baseBodies: Array<Record<string, unknown>> = [{ expression: code }, { command: code }];
  const candidates: Array<{ body: Record<string, unknown>; query?: Record<string, string> }> = [];
  for (const body of baseBodies) {
    candidates.push({ body });
    if (shard) {
      candidates.push({ body: { ...body, shard } });
      candidates.push({ body: { ...body, shardName: shard } });
      candidates.push({ body, query: { shard } });
    }
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    let response: ScreepsResponse;
    try {
      response = await screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: "/api/user/console",
        method: "POST",
        body: candidate.body,
        query: candidate.query,
        token: session.token,
        username: session.username,
      });
    } catch (error) {
      failures.push(toErrorText(error));
      continue;
    }

    if (!response.ok) {
      const reason = extractErrorMessage(response.data) ?? `HTTP ${response.status}`;
      failures.push(reason);
      continue;
    }

    const payloadError = extractPayloadError(response.data);
    if (payloadError) {
      failures.push(payloadError);
      continue;
    }

    return extractConsoleFeedback(response.data);
  }

  const reason = failures[0] ?? "Unknown error";
  throw new Error(`Failed to execute console command: ${reason}`);
}

interface TauriConsoleExecuteRequest {
  baseUrl: string;
  token: string;
  username: string;
  code: string;
  shard?: string | null;
}

interface TauriConsoleExecuteResponse {
  ok: boolean;
  feedback?: string | null;
  error?: string | null;
  usedVariant?: string | null;
  triedVariants?: string[] | null;
}

class TauriConsoleBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TauriConsoleBackendError";
  }
}

function isTauriConsoleBackendError(error: unknown): error is TauriConsoleBackendError {
  return error instanceof TauriConsoleBackendError;
}

function normalizeConsoleVariants(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

async function sendConsoleCommandByTauri(
  session: ScreepsSession,
  code: string,
  shardInput?: string
): Promise<string | undefined> {
  const request: TauriConsoleExecuteRequest = {
    baseUrl: session.baseUrl,
    token: session.token,
    username: session.username,
    code,
    shard: normalizeShard(shardInput) ?? null,
  };
  const response = await invoke<TauriConsoleExecuteResponse>("screeps_console_execute", {
    request,
  });

  if (!response.ok) {
    const backendError = sanitizeText(
      typeof response.error === "string" ? response.error : undefined
    );
    const triedVariants = normalizeConsoleVariants(response.triedVariants);
    const variantsHint =
      triedVariants.length > 0 ? ` (tried variants: ${triedVariants.join(", ")})` : "";
    throw new TauriConsoleBackendError(
      `${backendError ?? "Failed to execute console command."}${variantsHint}`
    );
  }

  return sanitizeConsoleFeedback(
    typeof response.feedback === "string" ? response.feedback : undefined
  );
}

export function buildConsoleLocalStateKey(baseUrl: string, username: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedUsername = username.trim().toLowerCase();
  return `console:v${CONSOLE_LOCAL_STATE_VERSION}:${normalizedBaseUrl}|${normalizedUsername}`;
}

export function readConsoleLocalState(storageKey: string): ConsoleLocalState {
  if (typeof window === "undefined") {
    return DEFAULT_CONSOLE_LOCAL_STATE;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return DEFAULT_CONSOLE_LOCAL_STATE;
    }
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return DEFAULT_CONSOLE_LOCAL_STATE;
    }
    const draft = typeof record.draft === "string" ? record.draft : "";
    const history = normalizeCommandList(Array.isArray(record.history) ? record.history : []);
    const favorites = normalizeFavoriteList(Array.isArray(record.favorites) ? record.favorites : []);
    return { draft, history, favorites };
  } catch {
    return DEFAULT_CONSOLE_LOCAL_STATE;
  }
}

export function writeConsoleLocalState(storageKey: string, state: ConsoleLocalState): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: ConsoleLocalState = {
    draft: state.draft,
    history: normalizeCommandList(state.history),
    favorites: normalizeFavoriteList(state.favorites),
  };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore storage write errors in restricted environments.
  }
}

export function updateConsoleHistory(history: string[], command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    return normalizeCommandList(history);
  }
  return normalizeCommandList([trimmed, ...history]);
}

export function updateConsoleFavorites(
  favorites: ConsoleFavorite[],
  command: string
): ConsoleFavorite[] {
  const code = command.trim();
  if (!code) {
    return normalizeFavoriteList(favorites);
  }
  const now = new Date().toISOString();
  const output: ConsoleFavorite[] = [{ code, updatedAt: now }];
  for (const favorite of favorites) {
    if (favorite.code === code) {
      continue;
    }
    output.push(favorite);
    if (output.length >= CONSOLE_FAVORITES_LIMIT) {
      break;
    }
  }
  return output;
}

export function removeConsoleFavorite(
  favorites: ConsoleFavorite[],
  command: string
): ConsoleFavorite[] {
  const code = command.trim();
  if (!code) {
    return normalizeFavoriteList(favorites);
  }
  return normalizeFavoriteList(favorites.filter((favorite) => favorite.code !== code));
}

export function hasConsoleFavorite(
  favorites: ConsoleFavorite[],
  command: string
): boolean {
  const code = command.trim();
  if (!code) {
    return false;
  }
  return favorites.some((favorite) => favorite.code === code);
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

  const dataRecord = asRecord(record.data);
  const payloadRecord = asRecord(record.payload);
  const messagesRecord = asRecord(record.messages);
  const direct = sanitizeText(
    firstString([
      record.output,
      record.stdout,
      record.stderr,
      record.result,
      record.message,
      record.text,
      record.status,
      record.error,
      dataRecord?.message,
      dataRecord?.text,
      dataRecord?.output,
      dataRecord?.error,
      payloadRecord?.message,
      payloadRecord?.text,
      payloadRecord?.output,
      payloadRecord?.error,
      messagesRecord?.message,
      messagesRecord?.error,
    ])
  );
  if (direct) {
    return direct;
  }

  const nestedCandidates = [
    record.messages,
    record.results,
    record.result,
    record.log,
    record.logs,
    record.lines,
    record.error,
    record.errors,
    record.data,
    record.payload,
  ];
  for (const candidate of nestedCandidates) {
    const nestedText = extractText(candidate);
    if (nestedText) {
      return nestedText;
    }
  }

  return toDebugText(record);
}

function extractTextEntries(value: unknown, depth = 0): string[] {
  if (depth > 7 || value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string") {
    const text = sanitizeText(value);
    return text ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    const output: string[] = [];
    for (const item of value) {
      output.push(...extractTextEntries(item, depth + 1));
    }
    return output;
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const primaryNestedKeys: Array<keyof typeof record> = [
    "log",
    "logs",
    "lines",
    "results",
    "result",
    "messages",
    "error",
    "errors",
  ];
  const primaryOutput: string[] = [];
  for (const key of primaryNestedKeys) {
    const candidate = record[key];
    if (candidate === undefined || candidate === null) {
      continue;
    }
    primaryOutput.push(...extractTextEntries(candidate, depth + 1));
  }
  if (primaryOutput.length > 0) {
    return primaryOutput;
  }

  for (const key of ["data", "payload"] as const) {
    const candidate = record[key];
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const nestedOutput = extractTextEntries(candidate, depth + 1);
    if (nestedOutput.length > 0) {
      return nestedOutput;
    }
  }

  const dataRecord = asRecord(record.data);
  const payloadRecord = asRecord(record.payload);
  const messagesRecord = asRecord(record.messages);
  const direct = sanitizeText(
    firstString([
      record.output,
      record.stdout,
      record.stderr,
      record.result,
      record.message,
      record.text,
      record.status,
      record.error,
      dataRecord?.message,
      dataRecord?.text,
      dataRecord?.output,
      dataRecord?.error,
      payloadRecord?.message,
      payloadRecord?.text,
      payloadRecord?.output,
      payloadRecord?.error,
      messagesRecord?.message,
      messagesRecord?.error,
    ])
  );
  if (direct) {
    return [direct];
  }

  const debug = toDebugText(record);
  return debug ? [debug] : [];
}

function inferKind(channel: string, payload: unknown): ConsoleStreamKind {
  const normalizedChannel = channel.trim().toLowerCase();
  const textLower =
    sanitizeText(extractTextEntries(payload).join("\n"))?.toLowerCase() ??
    extractText(payload)?.toLowerCase();

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
    normalizedChannel === "time" ||
    normalizedChannel === "protocol" ||
    normalizedChannel === "package" ||
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
  const [firstRecord] = normalizeConsoleStreamEvents(event);
  return firstRecord ?? null;
}

export function normalizeConsoleStreamEvents(
  event: ScreepsRealtimeEvent
): ConsoleStreamRecord[] {
  if (event.channel === "__state") {
    const state = firstString([asRecord(event.payload)?.state]) ?? "unknown";
    return [
      {
        id: buildRecordId(event),
        channel: event.channel,
        shard: inferShard(event.channel, event.payload),
        text: `state: ${state}`,
        receivedAt: event.receivedAt,
        kind: "system",
      },
    ];
  }
  if (event.channel === "auth") {
    const statusRaw =
      firstString([
        asRecord(event.payload)?.status,
        asRecord(event.payload)?.result,
        asRecord(event.payload)?.message,
      ]) ?? "unknown";
    const [statusHead] = statusRaw.split(/\s+/);
    return [
      {
        id: buildRecordId(event),
        channel: event.channel,
        shard: inferShard(event.channel, event.payload),
        text: `auth: ${(statusHead ?? statusRaw).toLowerCase()}`,
        receivedAt: event.receivedAt,
        kind: "system",
      },
    ];
  }

  if (isEmptyConsoleRealtimePayload(event.payload)) {
    return [];
  }

  const entries = extractTextEntries(event.payload);
  if (entries.length === 0) {
    return [];
  }

  const baseId = buildRecordId(event);
  const shard = inferShard(event.channel, event.payload);
  const kind = inferKind(event.channel, event.payload);
  return entries.map((text, index) => ({
    id: `${baseId}:${index}`,
    channel: event.channel,
    shard,
    text,
    receivedAt: event.receivedAt,
    kind,
  }));
}

export async function sendConsoleCommand(
  session: ScreepsSession,
  code: string,
  shardInput?: string
): Promise<ConsoleExecutionResult> {
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new Error("Console command cannot be empty.");
  }

  let feedback: string | undefined;
  if (hasTauriRuntime()) {
    try {
      feedback = await sendConsoleCommandByTauri(session, trimmedCode, shardInput);
    } catch (error) {
      if (isTauriConsoleBackendError(error)) {
        throw error;
      }
      feedback = await sendConsoleCommandByRequest(session, trimmedCode, shardInput);
    }
  } else {
    feedback = await sendConsoleCommandByRequest(session, trimmedCode, shardInput);
  }

  return {
    feedback,
    raw: trimmedCode,
    executedAt: new Date().toISOString(),
  };
}
