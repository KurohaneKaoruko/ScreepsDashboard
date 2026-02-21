import { screepsRequest } from "./request";
import type {
  MessageFolder,
  MessageSummary,
  MessagesPage,
  ScreepsSession,
  SendMessageInput,
} from "./types";

const DEFAULT_PAGE_LIMIT = 50;
const MIN_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 200;

interface FetchMessagesPageOptions {
  folder: MessageFolder;
  cursor?: string;
  limit?: number;
}

interface RequestCandidate {
  endpoint: string;
  method: "GET" | "POST";
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
}

interface ResolveCandidate {
  endpoint: string;
  method: "GET" | "POST";
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
}

interface ParsedMessagesResult {
  page: MessagesPage;
  confidence: number;
}

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

function participantFrom(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return firstString([
    record.username,
    record.name,
    record.user,
    record.respondent,
    record.from,
    record.to,
    record.target,
    record.recipient,
    record.sender,
    record.author,
    record.owner,
    record.player,
    record.id,
    record._id,
  ]);
}

function firstParticipant(values: unknown[]): string | undefined {
  for (const value of values) {
    const participant = participantFrom(value);
    if (participant) {
      return participant;
    }
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 0) {
      return false;
    }
    if (value === 1) {
      return true;
    }
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

function parseIsoDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const asMs = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(asMs);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    return parseIsoDate(asNumber);
  }

  const date = new Date(trimmed);
  if (Number.isFinite(date.getTime())) {
    return date.toISOString();
  }
  return undefined;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_PAGE_LIMIT;
  }
  const normalized = Math.floor(limit as number);
  return Math.max(MIN_PAGE_LIMIT, Math.min(MAX_PAGE_LIMIT, normalized));
}

function normalizeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }
  const trimmed = cursor.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLikelyUserId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^[0-9a-f]{24}$/i.test(trimmed)) {
    return true;
  }
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function normalizeFolder(value: unknown): MessageFolder | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "sent" || normalized === "outbox" || normalized === "outgoing") {
    return "sent";
  }
  if (
    normalized === "inbox" ||
    normalized === "incoming" ||
    normalized === "received" ||
    normalized === "recv"
  ) {
    return "inbox";
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

    const explicitError = firstString([record.error, record.err, record.errorMessage]);
    if (explicitError) {
      return explicitError;
    }

    const okFlag = record.ok;
    if (okFlag === 0 || okFlag === false || okFlag === "0") {
      return firstString([record.message, record.text, record.status]) ?? "Unknown error";
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return undefined;
}

function parseMessageItem(
  value: unknown,
  index: number,
  folder: MessageFolder,
  usernameLower: string
): MessageSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const nestedMessage = asRecord(record.message);
  const nestedData = asRecord(record.data);
  const respondent =
    participantFrom(record.respondent) ??
    participantFrom(nestedData?.respondent) ??
    participantFrom(nestedMessage?.respondent);
  const userParticipant =
    participantFrom(record.user) ??
    participantFrom(nestedData?.user) ??
    participantFrom(nestedMessage?.user);

  let from = firstParticipant([
    record.from,
    record.sender,
    record.fromUser,
    record.author,
    asRecord(record.from),
    asRecord(record.sender),
    asRecord(record.author),
    nestedMessage?.from,
    nestedData?.from,
    asRecord(nestedMessage?.from),
    asRecord(nestedData?.from),
    folder === "inbox" ? respondent : undefined,
    folder === "inbox" ? userParticipant : undefined,
    record.user,
  ]);

  let to = firstParticipant([
    record.to,
    record.recipient,
    record.toUser,
    record.target,
    asRecord(record.to),
    asRecord(record.recipient),
    asRecord(record.target),
    nestedMessage?.to,
    nestedData?.to,
    asRecord(nestedMessage?.to),
    asRecord(nestedData?.to),
    folder === "sent" ? respondent : undefined,
    folder === "sent" ? userParticipant : undefined,
    record.respondent,
  ]);

  if (!from && folder === "inbox") {
    from = respondent ?? userParticipant;
  }
  if (!to && folder === "sent") {
    to = respondent ?? userParticipant;
  }
  if (!from && folder === "sent") {
    from = userParticipant;
  }
  if (!to && folder === "inbox") {
    to = userParticipant;
  }

  if (usernameLower) {
    const fromLower = from?.toLowerCase();
    const toLower = to?.toLowerCase();

    if (!from && toLower === usernameLower) {
      from = respondent ?? userParticipant;
    }
    if (!to && fromLower === usernameLower) {
      to = respondent ?? userParticipant;
    }

    const updatedFromLower = from?.toLowerCase();
    const updatedToLower = to?.toLowerCase();
    if (updatedFromLower && updatedToLower && updatedFromLower === updatedToLower && respondent) {
      const respondentLower = respondent.toLowerCase();
      if (respondentLower !== updatedFromLower) {
        if (updatedFromLower === usernameLower) {
          to = respondent;
        } else {
          from = respondent;
        }
      }
    }
  }
  const subject = firstString([
    record.subject,
    record.title,
    record.topic,
    nestedMessage?.subject,
    nestedData?.subject,
  ]);
  const text = firstString([
    record.text,
    record.body,
    record.content,
    record.message,
    nestedMessage?.text,
    nestedMessage?.body,
    nestedData?.text,
    nestedData?.body,
  ]);

  const createdAt = parseIsoDate(
    firstString([record.createdAt, record.created, record.date, record.time, record.sent]) ??
      record.timestamp ??
      nestedMessage?.createdAt ??
      nestedData?.createdAt
  );

  const id =
    firstString([
      record._id,
      record.id,
      record.messageId,
      nestedMessage?._id,
      nestedData?._id,
    ]) ??
    `${createdAt ?? "0"}:${from ?? "--"}:${to ?? "--"}:${index}`;

  const unread =
    asBoolean(record.unread) ??
    asBoolean(record.new) ??
    (asBoolean(record.isRead) === false ? true : undefined);

  const explicitFolder =
    normalizeFolder(record.folder) ??
    normalizeFolder(record.direction) ??
    normalizeFolder(record.type);
  let resolvedFolder = explicitFolder ?? folder;
  if (!explicitFolder) {
    const fromLower = from?.toLowerCase();
    const toLower = to?.toLowerCase();
    if (fromLower && fromLower === usernameLower && toLower !== usernameLower) {
      resolvedFolder = "sent";
    } else if (toLower && toLower === usernameLower && fromLower !== usernameLower) {
      resolvedFolder = "inbox";
    }
  }

  if (!subject && !text && !from && !to) {
    return null;
  }

  return {
    id,
    folder: resolvedFolder,
    from,
    to,
    subject,
    text,
    unread,
    createdAt,
  };
}

function extractArrayCandidates(payload: unknown): {
  arrays: unknown[][];
  confidence: number;
  nextCursor?: string;
  hasMore?: boolean;
} {
  const arrays: unknown[][] = [];
  const seen = new Set<unknown[]>();
  let confidence = 0;
  let nextCursor: string | undefined;
  let hasMore: boolean | undefined;

  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }
    if (Array.isArray(current)) {
      if (!seen.has(current) && current.length > 0) {
        seen.add(current);
        arrays.push(current);
        confidence += 1;
      }
      for (const value of current) {
        queue.push(value);
      }
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      continue;
    }

    nextCursor =
      nextCursor ??
      firstString([
        record.nextCursor,
        record.cursor,
        record.next,
        record.offset,
        record.page,
        record.lastId,
      ]);
    hasMore =
      hasMore ??
      asBoolean(record.hasMore) ??
      asBoolean(record.more) ??
      asBoolean(record.hasNext) ??
      asBoolean(record.nextPage);

    const topArray = [
      record.messages,
      record.items,
      record.list,
      record.results,
      record.data,
      record.docs,
      record.threads,
    ].find((value) => Array.isArray(value));
    if (Array.isArray(topArray) && !seen.has(topArray)) {
      seen.add(topArray);
      arrays.push(topArray);
      confidence += 2;
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return { arrays, confidence, nextCursor, hasMore };
}

function parseMessagesPagePayload(
  payload: unknown,
  folder: MessageFolder,
  limit: number,
  usernameLower: string
): ParsedMessagesResult {
  const extracted = extractArrayCandidates(payload);

  const itemsById = new Map<string, MessageSummary>();
  for (const arrayValue of extracted.arrays) {
    for (let index = 0; index < arrayValue.length; index += 1) {
      const parsed = parseMessageItem(arrayValue[index], index, folder, usernameLower);
      if (!parsed || parsed.folder !== folder) {
        continue;
      }
      if (!itemsById.has(parsed.id)) {
        itemsById.set(parsed.id, parsed);
      }
    }
  }

  const items = [...itemsById.values()].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.id.localeCompare(right.id);
  });

  const hasMore =
    extracted.hasMore ?? (extracted.nextCursor !== undefined ? true : items.length >= limit);

  const page: MessagesPage = {
    fetchedAt: new Date().toISOString(),
    folder,
    items,
    nextCursor: extracted.nextCursor,
    hasMore,
  };

  if (!page.nextCursor && page.hasMore && items.length > 0) {
    page.nextCursor = items[items.length - 1].id;
  }

  const listConfidence =
    items.length > 0
      ? extracted.confidence + 2
      : extracted.confidence + (extracted.hasMore !== undefined || extracted.nextCursor ? 1 : 0);

  return {
    page,
    confidence: listConfidence,
  };
}

function buildListCandidates(
  folder: MessageFolder,
  cursor: string | undefined,
  limit: number
): RequestCandidate[] {
  const folderHints =
    folder === "sent"
      ? ["sent", "outbox", "outgoing"]
      : ["inbox", "incoming", "received"];

  const numericCursor = cursor ? Number.parseInt(cursor, 10) : NaN;
  const offsetHint = Number.isFinite(numericCursor) ? Math.max(0, numericCursor) : undefined;

  const candidates: RequestCandidate[] = [];
  for (const folderHint of folderHints) {
    candidates.push({
      endpoint: "/api/user/messages/index",
      method: "GET",
      query: {
        folder: folderHint,
        limit,
        ...(cursor ? { cursor } : {}),
      },
    });
    candidates.push({
      endpoint: "/api/user/messages/index",
      method: "POST",
      body: {
        folder: folderHint,
        limit,
        ...(cursor ? { cursor } : {}),
      },
    });
    candidates.push({
      endpoint: "/api/user/messages/list",
      method: "GET",
      query: {
        folder: folderHint,
        count: limit,
        ...(cursor ? { cursor } : {}),
        ...(offsetHint !== undefined ? { offset: offsetHint } : {}),
      },
    });
    candidates.push({
      endpoint: "/api/user/messages/list",
      method: "POST",
      body: {
        folder: folderHint,
        limit,
        ...(cursor ? { cursor } : {}),
        ...(offsetHint !== undefined ? { offset: offsetHint } : {}),
      },
    });
    candidates.push({
      endpoint: "/api/messages/index",
      method: "GET",
      query: {
        folder: folderHint,
        limit,
        ...(cursor ? { cursor } : {}),
      },
    });
  }
  return candidates;
}

export async function fetchMessagesPage(
  session: ScreepsSession,
  options: FetchMessagesPageOptions
): Promise<MessagesPage> {
  const folder: MessageFolder = options.folder;
  const limit = clampLimit(options.limit);
  const cursor = normalizeCursor(options.cursor);
  const usernameLower = session.username.trim().toLowerCase();

  const candidates = buildListCandidates(folder, cursor, limit);
  const failures: string[] = [];
  let bestParsed: ParsedMessagesResult | undefined;

  for (const candidate of candidates) {
    try {
      const response = await screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: candidate.endpoint,
        method: candidate.method,
        query: candidate.query,
        body: candidate.body,
        token: session.token,
        username: session.username,
      });

      if (!response.ok) {
        failures.push(`${candidate.endpoint} (${response.status})`);
        continue;
      }

      const payloadError = extractPayloadError(response.data);
      if (payloadError) {
        failures.push(payloadError);
        continue;
      }

      const parsed = parseMessagesPagePayload(response.data, folder, limit, usernameLower);
      if (!bestParsed || parsed.confidence > bestParsed.confidence) {
        bestParsed = parsed;
      }
      if (parsed.confidence > 0) {
        return parsed.page;
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Request failed");
    }
  }

  if (bestParsed) {
    return bestParsed.page;
  }

  const reason = failures[0] ?? "Failed to load messages.";
  throw new Error(`Failed to load messages: ${reason}`);
}

function sanitizeSendFeedback(value: string | undefined): string | undefined {
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
  return trimmed;
}

function extractSendFeedback(payload: unknown): string | undefined {
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }
    if (typeof current === "string") {
      const feedback = sanitizeSendFeedback(current);
      if (feedback) {
        return feedback;
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
    const feedback = sanitizeSendFeedback(
      firstString([record.message, record.status, record.result, record.text])
    );
    if (feedback) {
      return feedback;
    }
    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }
  return undefined;
}

export async function sendMessage(
  session: ScreepsSession,
  input: SendMessageInput
): Promise<string | undefined> {
  const to = input.to.trim();
  const subject = (input.subject ?? "").trim();
  const text = input.text.trim();

  if (!to) {
    throw new Error("Message recipient is required.");
  }
  if (!text) {
    throw new Error("Message body cannot be empty.");
  }

  const payloads: Array<Record<string, unknown>> = [
    { to, subject, text },
    { to, text, subject },
    { recipient: to, subject, text },
    { recipient: to, text, subject },
    { username: to, subject, text },
  ];
  const endpoints = ["/api/user/messages/send", "/api/messages/send", "/api/user/message/send"];

  const failures: string[] = [];
  for (const endpoint of endpoints) {
    for (const body of payloads) {
      try {
        const response = await screepsRequest({
          baseUrl: session.baseUrl,
          endpoint,
          method: "POST",
          body,
          token: session.token,
          username: session.username,
        });

        if (!response.ok) {
          failures.push(`${endpoint} (${response.status})`);
          continue;
        }

        const payloadError = extractPayloadError(response.data);
        if (payloadError) {
          failures.push(payloadError);
          continue;
        }

        return extractSendFeedback(response.data);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Request failed");
      }
    }
  }

  const reason = failures[0] ?? "Unknown error";
  throw new Error(`Failed to send message: ${reason}`);
}

function parseUsernameFromPayload(payload: unknown): string | undefined {
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }
    if (typeof current === "string") {
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
    const username = firstString([
      record.username,
      record.name,
      asRecord(record.user)?.username,
      asRecord(record.data)?.username,
      asRecord(record.result)?.username,
      asRecord(record.profile)?.username,
    ]);
    if (username) {
      return username;
    }
    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }
  return undefined;
}

function buildResolveCandidates(userId: string): ResolveCandidate[] {
  return [
    {
      endpoint: "/api/user/find",
      method: "GET",
      query: { id: userId },
    },
    {
      endpoint: "/api/user/find",
      method: "GET",
      query: { user: userId },
    },
    {
      endpoint: "/api/user/find",
      method: "POST",
      body: { id: userId },
    },
    {
      endpoint: "/api/user/find",
      method: "POST",
      body: { user: userId },
    },
    {
      endpoint: "/api/user/find",
      method: "POST",
      body: { ids: [userId] },
    },
    {
      endpoint: "/api/user/find",
      method: "POST",
      body: { _id: userId },
    },
    {
      endpoint: "/api/game/user/find",
      method: "GET",
      query: { id: userId },
    },
    {
      endpoint: "/api/game/user/find",
      method: "GET",
      query: { user: userId },
    },
    {
      endpoint: "/api/game/user/find",
      method: "POST",
      body: { id: userId },
    },
    {
      endpoint: "/api/game/user/find",
      method: "POST",
      body: { user: userId },
    },
    {
      endpoint: "/api/game/user/find",
      method: "POST",
      body: { _id: userId },
    },
  ];
}

const USERNAME_RESOLVE_CACHE = new Map<string, string>();

export async function resolveUsernamesByIds(
  session: ScreepsSession,
  ids: string[]
): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  const unresolved = [...new Set(ids.map((item) => item.trim()).filter((item) => item.length > 0))];

  for (const userId of unresolved) {
    const cacheKey = `${session.baseUrl}|${userId.toLowerCase()}`;
    const cached = USERNAME_RESOLVE_CACHE.get(cacheKey);
    if (cached) {
      output[userId] = cached;
    }
  }

  for (const userId of unresolved) {
    if (output[userId] || !isLikelyUserId(userId)) {
      continue;
    }
    const candidates = buildResolveCandidates(userId);
    for (const candidate of candidates) {
      try {
        const response = await screepsRequest({
          baseUrl: session.baseUrl,
          endpoint: candidate.endpoint,
          method: candidate.method,
          query: candidate.query,
          body: candidate.body,
          token: session.token,
          username: session.username,
        });
        if (!response.ok) {
          continue;
        }
        const payloadError = extractPayloadError(response.data);
        if (payloadError) {
          continue;
        }
        const username = parseUsernameFromPayload(response.data);
        if (username) {
          output[userId] = username;
          USERNAME_RESOLVE_CACHE.set(`${session.baseUrl}|${userId.toLowerCase()}`, username);
          break;
        }
      } catch {
        // Keep trying candidates.
      }
    }
  }

  return output;
}

export async function fetchConversationMessages(
  session: ScreepsSession,
  respondentInput: string,
  limitInput = DEFAULT_PAGE_LIMIT,
  aliasesInput: string[] = []
): Promise<MessageSummary[]> {
  const respondent = respondentInput.trim();
  if (!respondent) {
    return [];
  }

  const limit = clampLimit(limitInput);
  const usernameLower = session.username.trim().toLowerCase();
  const respondentCandidates = new Set<string>();
  respondentCandidates.add(respondent.toLowerCase());
  for (const alias of aliasesInput) {
    const normalized = alias.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    respondentCandidates.add(normalized);
  }

  try {
    const paged = await fetchConversationMessagesFromFolders(
      session,
      respondent,
      respondentCandidates,
      limit,
      usernameLower
    );
    if (paged.length > 0) {
      return paged;
    }
  } catch {
    // Fallback to direct conversation endpoint candidates below.
  }

  const requestCandidates: RequestCandidate[] = [
    {
      endpoint: "/api/user/messages/list",
      method: "GET",
      query: { respondent, limit, count: limit, offset: 0 },
    },
    {
      endpoint: "/api/user/messages/list",
      method: "GET",
      query: { user: respondent, limit, count: limit, offset: 0 },
    },
    {
      endpoint: "/api/user/messages/list",
      method: "POST",
      body: { respondent, limit, count: limit, offset: 0 },
    },
    {
      endpoint: "/api/user/messages/list",
      method: "POST",
      body: { user: respondent, limit, count: limit, offset: 0 },
    },
    {
      endpoint: "/api/user/messages/list",
      method: "POST",
      body: { respondentId: respondent, limit, count: limit, offset: 0 },
    },
  ];

  let best: MessageSummary[] = [];
  for (const candidate of requestCandidates) {
    try {
      const response = await screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: candidate.endpoint,
        method: candidate.method,
        query: candidate.query,
        body: candidate.body,
        token: session.token,
        username: session.username,
      });
      if (!response.ok) {
        continue;
      }
      const payloadError = extractPayloadError(response.data);
      if (payloadError) {
        continue;
      }

      // Try both defaults since some servers omit an explicit direction.
      const asInbox = parseMessagesPagePayload(response.data, "inbox", limit, usernameLower).page.items;
      const asSent = parseMessagesPagePayload(response.data, "sent", limit, usernameLower).page.items;
      const merged = mergeMessagesById(asInbox, asSent, respondent, usernameLower);
      if (merged.length > best.length) {
        best = merged;
      }
      if (merged.length >= 2) {
        break;
      }
    } catch {
      // Keep trying candidates.
    }
  }

  return best.slice(-limit);
}

function mergeMessagesById(
  left: MessageSummary[],
  right: MessageSummary[],
  respondent: string,
  usernameLower: string
): MessageSummary[] {
  const map = new Map<string, MessageSummary>();
  for (const item of [...left, ...right]) {
    const normalized = normalizeConversationMessage(item, respondent, usernameLower);
    const key = messageMergeKey(normalized);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, normalized);
      continue;
    }
    map.set(key, {
      ...existing,
      folder: existing.folder,
      from: existing.from ?? normalized.from,
      to: existing.to ?? normalized.to,
      text: existing.text ?? normalized.text,
      subject: existing.subject ?? normalized.subject,
      createdAt: existing.createdAt ?? normalized.createdAt,
      unread: existing.unread ?? normalized.unread,
    });
  }
  return [...map.values()].sort((a, b) => {
    const leftTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const rightTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return a.id.localeCompare(b.id);
  });
}

function normalizeConversationMessage(
  item: MessageSummary,
  respondent: string,
  usernameLower: string
): MessageSummary {
  let from = item.from?.trim();
  let to = item.to?.trim();
  const respondentTrimmed = respondent.trim();
  const respondentLower = respondentTrimmed.toLowerCase();

  if (!from && !to) {
    if (item.folder === "sent") {
      from = usernameLower || undefined;
      to = respondentTrimmed;
    } else if (item.folder === "inbox") {
      from = respondentTrimmed;
      to = usernameLower || undefined;
    }
  } else {
    const fromLower = from?.toLowerCase();
    const toLower = to?.toLowerCase();
    if (fromLower && fromLower === usernameLower && !to) {
      to = respondentTrimmed;
    }
    if (toLower && toLower === usernameLower && !from) {
      from = respondentTrimmed;
    }
    if (from && to && from.toLowerCase() === to.toLowerCase()) {
      if (from.toLowerCase() === usernameLower) {
        to = respondentTrimmed;
      } else if (from.toLowerCase() === respondentLower) {
        to = usernameLower || to;
      }
    }
  }

  return {
    ...item,
    from,
    to,
  };
}

function normalizeParticipant(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeMessageText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function messageMergeKey(item: MessageSummary): string {
  const id = (item.id?.trim() ?? "").toLowerCase();
  return [
    "msg",
    id,
    item.createdAt ?? "",
    normalizeParticipant(item.from),
    normalizeParticipant(item.to),
    normalizeMessageText(item.subject),
    normalizeMessageText(item.text),
  ].join("|");
}

function messageBelongsToConversation(
  item: MessageSummary,
  respondentCandidates: Set<string>,
  usernameLower: string
): boolean {
  if (respondentCandidates.size === 0) {
    return false;
  }
  const fromLower = normalizeParticipant(item.from);
  const toLower = normalizeParticipant(item.to);
  if (respondentCandidates.has(fromLower) || respondentCandidates.has(toLower)) {
    return true;
  }
  if (!fromLower && !toLower) {
    return false;
  }
  if (item.folder === "inbox") {
    return fromLower !== usernameLower && fromLower.length > 0 && respondentCandidates.has(fromLower);
  }
  if (item.folder === "sent") {
    return toLower !== usernameLower && toLower.length > 0 && respondentCandidates.has(toLower);
  }
  return false;
}

async function fetchConversationMessagesFromFolders(
  session: ScreepsSession,
  respondent: string,
  respondentCandidates: Set<string>,
  limit: number,
  usernameLower: string
): Promise<MessageSummary[]> {
  if (!respondent.trim() || respondentCandidates.size === 0) {
    return [];
  }

  const pageSize = Math.max(MIN_PAGE_LIMIT, Math.min(80, limit));
  const maxPages = Math.max(2, Math.min(8, Math.ceil(limit / pageSize) + 2));
  const matchedById = new Map<string, MessageSummary>();

  for (const folder of ["inbox", "sent"] as const) {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (let page = 0; page < maxPages; page += 1) {
      const result = await fetchMessagesPage(session, { folder, cursor, limit: pageSize });
      for (const item of result.items) {
        if (!messageBelongsToConversation(item, respondentCandidates, usernameLower)) {
          continue;
        }
        const normalized = normalizeConversationMessage(item, respondent, usernameLower);
        const key = messageMergeKey(normalized);
        const existing = matchedById.get(key);
        if (!existing) {
          matchedById.set(key, normalized);
        } else {
          matchedById.set(key, {
            ...existing,
            folder: existing.folder,
            from: existing.from ?? normalized.from,
            to: existing.to ?? normalized.to,
            text: existing.text ?? normalized.text,
            subject: existing.subject ?? normalized.subject,
            createdAt: existing.createdAt ?? normalized.createdAt,
            unread: existing.unread ?? normalized.unread,
          });
        }
      }

      if (matchedById.size >= limit || !result.hasMore || !result.nextCursor) {
        break;
      }
      if (seenCursors.has(result.nextCursor)) {
        break;
      }
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  }

  return [...matchedById.values()]
    .sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(-limit);
}
