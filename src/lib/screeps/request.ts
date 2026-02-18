import { invoke } from "@tauri-apps/api/core";
import type { QueryParams, ScreepsRequest, ScreepsResponse } from "./types";

const DEFAULT_SERVER_URL = "https://screeps.com";
const FALLBACK_TIMEOUT_MS = 20_000;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
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

async function browserFallbackRequest(request: ScreepsRequest): Promise<ScreepsResponse> {
  const url = buildApiUrl(request.baseUrl, request.endpoint, request.query);
  const method = request.method ?? "GET";
  const headers = new Headers({
    Accept: "application/json",
  });

  const token = request.token?.trim();
  if (token) {
    headers.set("X-Token", token);
    headers.set("X-Username", token);
    headers.set("Authorization", `Bearer ${token}`);
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
  } catch (error) {
    throw new Error(`Browser fallback request failed: ${getErrorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function screepsRequest(request: ScreepsRequest): Promise<ScreepsResponse> {
  if (typeof window === "undefined") {
    throw new Error("Screeps request is only supported in browser/Tauri context.");
  }

  const normalizedRequest: ScreepsRequest = {
    ...request,
    baseUrl: normalizeBaseUrl(request.baseUrl),
    endpoint: normalizeEndpoint(request.endpoint),
    method: request.method ?? "GET",
  };

  try {
    return await invoke<ScreepsResponse>("screeps_request", {
      request: normalizedRequest,
    });
  } catch {
    return browserFallbackRequest(normalizedRequest);
  }
}
