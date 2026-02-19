import { normalizeBaseUrl } from "./request";

export type RealtimeConnectionState = "idle" | "connecting" | "connected" | "closed";

export interface ScreepsRealtimeEvent {
  channel: string;
  payload: unknown;
  raw: string;
  receivedAt: string;
}

export interface ScreepsRealtimeClientOptions {
  baseUrl: string;
  token?: string;
  reconnect?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

type RealtimeHandler = (event: ScreepsRealtimeEvent) => void;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseTextPayload(rawPayload: string): unknown {
  const text = rawPayload.trim();
  if (!text) {
    return null;
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  if (text === "null") {
    return null;
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }

  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }

  return text;
}

function parseSocketLine(line: string): { channel: string; payload: unknown } | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const directPayload = parseTextPayload(trimmed);
  const directRecord = asRecord(directPayload);
  if (directRecord) {
    const eventName =
      typeof directRecord.event === "string"
        ? directRecord.event
        : typeof directRecord.channel === "string"
          ? directRecord.channel
          : undefined;
    if (eventName) {
      return {
        channel: eventName,
        payload:
          directRecord.data ?? directRecord.payload ?? directRecord.message ?? directPayload,
      };
    }
  }

  const separatorIndex = trimmed.indexOf(" ");
  if (separatorIndex < 0) {
    return {
      channel: trimmed,
      payload: null,
    };
  }

  const channel = trimmed.slice(0, separatorIndex).trim();
  const payloadText = trimmed.slice(separatorIndex + 1).trim();
  const payload = parseTextPayload(payloadText);

  if (channel === "auth" && typeof payload === "string") {
    return {
      channel,
      payload: { status: payload },
    };
  }

  return {
    channel,
    payload,
  };
}

function normalizeWebSocketPath(pathname: string): string {
  const normalizedPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const socketPath = `${normalizedPath}/socket/websocket`;
  return socketPath.replace(/\/{2,}/g, "/");
}

async function readSocketDataAsText(data: unknown): Promise<string | null> {
  if (typeof data === "string") {
    return data;
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text();
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new TextDecoder().decode(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  return null;
}

export function buildScreepsSocketUrl(baseUrl: string, token?: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const url = new URL(normalizedBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = normalizeWebSocketPath(url.pathname);

  const trimmedToken = token?.trim();
  if (trimmedToken) {
    url.searchParams.set("_token", trimmedToken);
  }

  return url.toString();
}

export class ScreepsRealtimeClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly reconnect: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;
  private state: RealtimeConnectionState = "idle";

  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly subscriptions = new Map<string, number>();

  constructor(options: ScreepsRealtimeClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token?.trim() || undefined;
    this.reconnect = options.reconnect ?? true;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 20_000;
  }

  get connectionState(): RealtimeConnectionState {
    return this.state;
  }

  connect(): void {
    this.manualClose = false;
    this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;

    if (this.socket) {
      const current = this.socket;
      this.socket = null;
      current.close(1000, "client_disconnect");
    }

    this.setState("closed");
  }

  on(channel: string, handler: RealtimeHandler): () => void {
    const key = channel.trim();
    if (!key) {
      return () => {};
    }

    const channelHandlers = this.handlers.get(key) ?? new Set<RealtimeHandler>();
    channelHandlers.add(handler);
    this.handlers.set(key, channelHandlers);

    return () => {
      this.off(key, handler);
    };
  }

  off(channel: string, handler: RealtimeHandler): void {
    const key = channel.trim();
    if (!key) {
      return;
    }

    const channelHandlers = this.handlers.get(key);
    if (!channelHandlers) {
      return;
    }

    channelHandlers.delete(handler);
    if (channelHandlers.size === 0) {
      this.handlers.delete(key);
    }
  }

  subscribe(channel: string, handler?: RealtimeHandler): () => void {
    const key = channel.trim();
    if (!key) {
      return () => {};
    }

    if (handler) {
      this.on(key, handler);
    }

    const currentCount = this.subscriptions.get(key) ?? 0;
    this.subscriptions.set(key, currentCount + 1);
    if (currentCount === 0) {
      this.sendCommand(`subscribe ${key}`);
    }

    return () => {
      this.unsubscribe(key, handler);
    };
  }

  unsubscribe(channel: string, handler?: RealtimeHandler): void {
    const key = channel.trim();
    if (!key) {
      return;
    }

    if (handler) {
      this.off(key, handler);
    }

    const currentCount = this.subscriptions.get(key) ?? 0;
    if (currentCount <= 1) {
      this.subscriptions.delete(key);
      this.sendCommand(`unsubscribe ${key}`);
      return;
    }

    this.subscriptions.set(key, currentCount - 1);
  }

  send(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }
    this.sendCommand(trimmed);
  }

  private setState(next: RealtimeConnectionState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.emit("__state", { state: next }, `__state ${next}`);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnect || this.manualClose) {
      return;
    }

    this.clearReconnectTimer();
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxMs
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private openSocket(): void {
    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        return;
      }
    }

    this.clearReconnectTimer();
    this.setState("connecting");

    const socketUrl = buildScreepsSocketUrl(this.baseUrl, this.token);
    const socket = new WebSocket(socketUrl);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempt = 0;
      this.setState("connected");

      if (this.token) {
        this.sendCommand(`auth ${this.token}`);
      }
      this.sendCommand("gzip off");
      for (const channel of this.subscriptions.keys()) {
        this.sendCommand(`subscribe ${channel}`);
      }
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    socket.addEventListener("error", () => {
      this.emit("__error", { state: this.state }, "__error");
    });

    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.setState("closed");
      this.scheduleReconnect();
    });
  }

  private sendCommand(command: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(command);
  }

  private async handleMessage(rawData: unknown): Promise<void> {
    const text = await readSocketDataAsText(rawData);
    if (!text) {
      return;
    }

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseSocketLine(line);
      if (!parsed) {
        continue;
      }
      this.emit(parsed.channel, parsed.payload, line);
    }
  }

  private emit(channel: string, payload: unknown, raw: string): void {
    const event: ScreepsRealtimeEvent = {
      channel,
      payload,
      raw,
      receivedAt: new Date().toISOString(),
    };

    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      for (const handler of channelHandlers) {
        handler(event);
      }
    }

    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(event);
      }
    }
  }
}
