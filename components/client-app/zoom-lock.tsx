"use client";

import * as React from "react";

/**
 * Keeps the client app at one scale.
 *
 * `user-scalable=no` in the viewport is enough in an installed app, but Safari
 * on iOS has ignored it in a browser tab since iOS 10 — deliberately, as an
 * accessibility decision. The only thing left that stops a pinch there is
 * refusing WebKit's own gesture events, which is what this does.
 *
 * It takes pinch-zoom away and nothing else: these events fire only for a
 * two-finger zoom gesture, so scrolling, swiping a sheet away and the camera
 * in the QR scanner are untouched. Double-tap zoom is handled in CSS, by
 * `touch-action: manipulation` on the app.
 */

/** WebKit's gesture events, which no standard type covers. */
const PINCH_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

/**
 * Refuses pinch gestures on `target` and returns the undo.
 *
 * Separate from the component so it can be tested without a browser — the
 * listeners have to be non-passive or preventDefault does nothing, and that is
 * exactly the sort of detail that breaks silently.
 */
export function blockPinchZoom(target: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
  const refuse = (event: Event) => event.preventDefault();
  for (const name of PINCH_EVENTS) target.addEventListener(name, refuse, { passive: false });
  return () => {
    for (const name of PINCH_EVENTS) target.removeEventListener(name, refuse);
  };
}

export function ZoomLock() {
  React.useEffect(() => blockPinchZoom(document), []);
  return null;
}
