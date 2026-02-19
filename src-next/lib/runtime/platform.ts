"use client";

function readUserAgent(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  return navigator.userAgent ?? "";
}

export function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function isLikelyMobilePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const uaData = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (uaData.userAgentData?.mobile) {
    return true;
  }

  return /android|iphone|ipad|ipod|mobile/i.test(readUserAgent());
}

export function isDesktopWindowFrameAvailable(): boolean {
  return hasTauriRuntime() && !isLikelyMobilePlatform();
}

