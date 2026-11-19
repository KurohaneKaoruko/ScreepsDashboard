import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWebTransportUrl } from "./web-transport";
import { buildScreepsSocketUrl } from "../screeps/realtime-client";

afterEach(() => vi.unstubAllGlobals());
function browser(gateway?: string) {
  vi.stubGlobal("window", { location: { origin: "https://dashboard.example" }, __SCREEPS_WEB_CONFIG__: { gateway } });
  vi.stubGlobal("document", { baseURI: "https://dashboard.example/index.html" });
}

describe("Web connection routing", () => {
  it("routes API requests through the same-origin gateway preserving server base paths", () => {
    browser("/_screeps/");
    const result = new URL(resolveWebTransportUrl("http://private.example:21025/world/api/game/room-objects?room=W1N1&shard=main"));
    expect(result.origin).toBe("https://dashboard.example");
    expect(decodeURIComponent(result.pathname)).toBe("/_screeps/http://private.example:21025/world/api/game/room-objects");
    expect(result.searchParams.get("shard")).toBe("main");
  });
  it("uses same-origin WSS for a private HTTP server without exposing it to mixed-content restrictions", () => {
    browser("/_screeps/");
    const url = new URL(buildScreepsSocketUrl("http://private.example:21025", "test"));
    expect(url.protocol).toBe("wss:");
    expect(url.hostname).toBe("dashboard.example");
    expect(url.searchParams.get("_token")).toBe("test");
  });
  it("preserves direct HTTP/WS transport for static hosts and private servers", () => {
    browser();
    expect(buildScreepsSocketUrl("http://private.example:21025")).toBe("ws://private.example:21025/socket/websocket");
    expect(resolveWebTransportUrl("https://screeps.com/api/auth/me")).toBe("https://screeps.com/api/auth/me");
  });
  it("does not send credentials to a gateway on a different origin", () => {
    browser("https://other.example/_screeps/");
    expect(() => resolveWebTransportUrl("https://screeps.com/api/auth/me")).toThrow("origin");
  });
  it("keeps native requests direct even when Web runtime configuration exists", () => {
    browser("/_screeps/");
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    expect(resolveWebTransportUrl("https://screeps.com/api/auth/me")).toBe("https://screeps.com/api/auth/me");
  });
});
