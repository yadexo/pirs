"use client";

import { useEffect } from "react";

/** The CSS transition's own duration, read at dismiss time rather than hardcoded twice. */
export function dismissDurationMs(raw: string | null): number {
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 220;
}

/**
 * The guaranteed half of dismissing the launch screen. Splash (splash.tsx)
 * is the fast half — an inline `<script nonce>` that beats this to it on an
 * ordinary hard page load, gone before React has even hydrated.
 *
 * That inline script is parsed as part of the original HTML, so it only
 * runs if its `nonce` attribute matches the CSP the browser locked onto
 * *this document* — and middleware.ts mints a fresh nonce on every single
 * request, including the one behind a soft (client-side) navigation into
 * this layout. A client who reaches the client app by a redirect rather
 * than typing the URL — signing in, say — can have this layout's JSX,
 * inline script included, rendered from a *different* request than the one
 * that set the document's own CSP header. The two nonces don't match, the
 * browser refuses to run that script, and nothing was left to remove the
 * overlay — it isn't CSP-gated itself, only the script that was supposed to
 * take it away. Confirmed on Chromium always re-matching; the field report
 * this fixes is from Safari, which this repo has no way to drive directly.
 *
 * This component has no such dependency: a React effect is application
 * logic running inside the one script that's already executing (the main
 * bundle, trusted once at load and never re-evaluated), not a new script
 * resource the browser has to decide whether to trust. It needs no nonce,
 * no 'strict-dynamic' (which only extends trust to scripts another trusted
 * script *creates* — an inline `<script>` with the wrong nonce doesn't
 * qualify either way), nothing from the CSP at all. Mounts once per layout
 * instance; a no-op if the fast path already won.
 */
export function SplashDismiss() {
  useEffect(() => {
    const el = document.getElementById("ca-splash");
    if (!el) return;
    el.classList.add("ca-splash-out");
    const ms = dismissDurationMs(getComputedStyle(document.documentElement).getPropertyValue("--duration-base"));
    const t = setTimeout(() => el.remove(), ms);
    return () => clearTimeout(t);
  }, []);
  return null;
}
