import { hasTauriRuntime } from "./platform";

declare global {
  interface Window {
    __SCREEPS_WEB_CONFIG__?: { gateway?: string };
  }
}

/** Load deployment settings before mounting the app; native builds keep their own transport. */
export async function loadWebConfiguration(): Promise<void> {
  if (hasTauriRuntime()) return;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(new URL("web-config.json", document.baseURI), {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) return;
    const config: unknown = await response.json();
    if (config && typeof config === "object" && "gateway" in config && typeof config.gateway === "string") {
      window.__SCREEPS_WEB_CONFIG__ = { gateway: config.gateway };
    }
  } catch {
    // A plain static host can use direct API connections when its upstream permits CORS.
  } finally {
    window.clearTimeout(timer);
  }
}

/** Static hosts can use direct requests; the bundled Web server supplies a gateway. */
export function resolveWebTransportUrl(input: string): string {
  if (typeof window === "undefined" || hasTauriRuntime()) {
    return input;
  }
  const gateway = window.__SCREEPS_WEB_CONFIG__?.gateway;
  if (!gateway) {
    return input;
  }

  const upstream = new URL(input);
  const gatewayBase = new URL(gateway, document.baseURI);
  // Tokens must only travel through the gateway served with this application.
  if (gatewayBase.origin !== window.location.origin) {
    throw new Error("The Screeps Web gateway must use the application's origin.");
  }
  const apiIndex = upstream.pathname.indexOf("/api/");
  const socketIndex = upstream.pathname.indexOf("/socket/");
  const boundary = apiIndex >= 0 ? apiIndex : socketIndex;
  if (boundary < 0) {
    return input;
  }
  const baseUrl = `${upstream.origin}${upstream.pathname.slice(0, boundary)}`;
  const url = new URL(`${encodeURIComponent(baseUrl)}${upstream.pathname.slice(boundary)}${upstream.search}`, gatewayBase);
  return url.toString();
}
