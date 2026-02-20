import { invoke } from "@tauri-apps/api/core";
import type { QueryParams, ScreepsRequest, ScreepsResponse } from "./types";
import { hasTauriRuntime } from "../runtime/platform";

const DEFAULT_SERVER_URL = "https://screeps.com";
const FALLBACK_TIMEOUT_MS = 20_000;
const TAURI_RETRY_BACKOFF_MS = 8_000;
const TAURI_BATCH_DEFAULT_CONCURRENCY = 8;
const TAURI_BATCH_MAX_CONCURRENCY = 24;

type RequestRuntimeMode = "unknown" | "tauri" | "browser";
let requestRuntimeMode: RequestRuntimeMode = "unknown";
let tauriRetryAt = 0;

const inflightRequestByKey = new Map<string, Promise<ScreepsResponse>>();

interface ScreepsBatchInvokePayload {
  requests: ScreepsRequest[];
  maxConcurrency?: number;
}

interface ScreepsBatchRequestOptions {
  maxConcurrency?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolveFn?.(value);
    },
  };
}

function stableSerialize(value: unknown): string {
  const visited = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, current) => {
    if (typeof current !== "object" || current === null) {
      return current;
    }

    if (visited.has(current)) {
      return "[Circular]";
    }
    visited.add(current);

    if (Array.isArray(current)) {
      return current;
    }

    const source = current as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = source[key];
    }
    return sorted;
  });
  return serialized ?? "null";
}

function requestIdentity(request: ScreepsRequest): string {
  return [
    request.method ?? "GET",
    request.baseUrl,
    request.endpoint,
    stableSerialize(request.query ?? {}),
    stableSerialize(request.body ?? null),
    request.token?.trim() ?? "",
    request.username?.trim() ?? "",
  ].join("|");
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function normalizeRequest(request: ScreepsRequest): ScreepsRequest {
  return {
    ...request,
    baseUrl: normalizeBaseUrl(request.baseUrl),
    endpoint: normalizeEndpoint(request.endpoint),
    method: request.method ?? "GET",
  };
}

function normalizeBatchConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return TAURI_BATCH_DEFAULT_CONCURRENCY;
  }
  return Math.max(1, Math.min(TAURI_BATCH_MAX_CONCURRENCY, Math.floor(value)));
}

export function normalizeBaseUrl(rawInput: string): string {
  const input = rawInput.trim().length > 0 ? rawInput.trim() : DEFAULT_SERVER_URL;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const url = new URL(withProtocol);
    if (url.pathname.endsWith("/api")) {
      url.pathname = url.pathname.slice(0, -4);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid server URL: ${rawInput}`);
  }
}

export function buildApiUrl(baseUrl: string, endpoint: string, query?: QueryParams): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${normalizeEndpoint(endpoint)}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function toErrorResponse(request: ScreepsRequest, error: unknown): ScreepsResponse {
  return {
    status: 0,
    ok: false,
    data: {
      error: getErrorMessage(error),
    },
    url: buildApiUrl(request.baseUrl, request.endpoint, request.query),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const output = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index]);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return output;
}

async function browserFallbackRequest(request: ScreepsRequest): Promise<ScreepsResponse> {
  const url = buildApiUrl(request.baseUrl, request.endpoint, request.query);
  const method = request.method ?? "GET";
  const headers = new Headers({
    Accept: "application/json",
  });

  const token = request.token?.trim();
  const username = request.username?.trim();
  if (token) {
    headers.set("X-Token", token);
    if (username) {
      headers.set("X-Username", username);
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(request.body ?? {}),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data: unknown = {};
    if (rawText.length > 0) {
      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        data = { text: rawText };
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
      url: response.url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function browserFallbackBatchRequest(
  requests: ScreepsRequest[],
  maxConcurrency?: number
): Promise<ScreepsResponse[]> {
  const concurrency = normalizeBatchConcurrency(maxConcurrency);
  return mapWithConcurrency(requests, concurrency, (request) =>
    browserFallbackRequest(request).catch((error) => toErrorResponse(request, error))
  );
}

function ensureRuntimeMode(): RequestRuntimeMode {
  if (requestRuntimeMode === "unknown") {
    requestRuntimeMode = hasTauriRuntime() ? "tauri" : "browser";
  }
  return requestRuntimeMode;
}

async function dispatchBatchRequests(
  requests: ScreepsRequest[],
  options?: ScreepsBatchRequestOptions
): Promise<ScreepsResponse[]> {
  const runtimeMode = ensureRuntimeMode();

  if (runtimeMode === "tauri") {
    const now = Date.now();
    if (now >= tauriRetryAt) {
      try {
        const batchPayload: ScreepsBatchInvokePayload = {
          requests,
          maxConcurrency: normalizeBatchConcurrency(options?.maxConcurrency),
        };
        const responses = await invoke<ScreepsResponse[]>("screeps_request_many", {
          batch: batchPayload,
        });

        if (Array.isArray(responses) && responses.length === requests.length) {
          tauriRetryAt = 0;
          return responses;
        }

        tauriRetryAt = now + TAURI_RETRY_BACKOFF_MS;
      } catch {
        // Temporary fallback: keep trying Tauri bridge after a short backoff.
        tauriRetryAt = now + TAURI_RETRY_BACKOFF_MS;
      }
    }
  }

  return browserFallbackBatchRequest(requests, options?.maxConcurrency);
}

export async function screepsBatchRequest(
  requests: ScreepsRequest[],
  options?: ScreepsBatchRequestOptions
): Promise<ScreepsResponse[]> {
  if (typeof window === "undefined") {
    throw new Error("Screeps request is only supported in browser/Tauri context.");
  }

  if (requests.length === 0) {
    return [];
  }

  const normalizedRequests = requests.map(normalizeRequest);
  const requestPromises: Array<Promise<ScreepsResponse>> = new Array(normalizedRequests.length);
  const deferredByKey = new Map<string, Deferred<ScreepsResponse>>();
  const newRequests: ScreepsRequest[] = [];
  const newKeys: string[] = [];

  for (let index = 0; index < normalizedRequests.length; index += 1) {
    const request = normalizedRequests[index];
    const requestKey = requestIdentity(request);

    const inflight = inflightRequestByKey.get(requestKey);
    if (inflight) {
      requestPromises[index] = inflight;
      continue;
    }

    const existingDeferred = deferredByKey.get(requestKey);
    if (existingDeferred) {
      requestPromises[index] = existingDeferred.promise;
      continue;
    }

    const deferred = createDeferred<ScreepsResponse>();
    deferredByKey.set(requestKey, deferred);
    inflightRequestByKey.set(requestKey, deferred.promise);
    requestPromises[index] = deferred.promise;
    newRequests.push(request);
    newKeys.push(requestKey);
  }

  if (newRequests.length > 0) {
    void dispatchBatchRequests(newRequests, options)
      .then((responses) => {
        for (let index = 0; index < newRequests.length; index += 1) {
          const request = newRequests[index];
          const requestKey = newKeys[index];
          const deferred = deferredByKey.get(requestKey);
          deferred?.resolve(responses[index] ?? toErrorResponse(request, "missing response"));
        }
      })
      .catch((error) => {
        for (let index = 0; index < newRequests.length; index += 1) {
          const request = newRequests[index];
          const requestKey = newKeys[index];
          const deferred = deferredByKey.get(requestKey);
          deferred?.resolve(toErrorResponse(request, error));
        }
      })
      .finally(() => {
        for (const requestKey of newKeys) {
          inflightRequestByKey.delete(requestKey);
        }
      });
  }

  return Promise.all(requestPromises);
}

export async function screepsRequest(request: ScreepsRequest): Promise<ScreepsResponse> {
  const [response] = await screepsBatchRequest([request], { maxConcurrency: 1 });
  if (!response) {
    return toErrorResponse(normalizeRequest(request), "Request failed: empty response");
  }
  return response;
}
