"use client";

import * as React from "react";

/**
 * Registers the clients' service worker (offline page, fast relaunch, push).
 * `scope` is the clinic's own base path, so the worker controls exactly the
 * pages the installed app runs on — on the root domain that is /riverside/,
 * not /app/.
 */
export function ServiceWorker({ scope }: { scope: string }) {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    // The build id rides along in the URL: a changed script URL is what makes
    // the browser install a new worker, and the worker reads it back out to
    // name its cache. Without it, last release's chunks are served forever.
    const url = `/client-sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? "dev")}`;
    navigator.serviceWorker.register(url, { scope }).catch(() => {});
  }, [scope]);
  return null;
}

/** Running from the Home Screen icon rather than in a browser tab. */
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * An iPhone or an iPad — asked only to know that notifications need the
 * installed app. Which install instructions a client needs is a harder
 * question, and lib/install-platform.ts answers it.
 */
export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}
