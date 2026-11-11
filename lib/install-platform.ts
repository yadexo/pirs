/**
 * Which device and browser a client is using, and therefore how — or whether —
 * they can install the clinic's app.
 *
 * Pure, with no imports and nothing read from `window`: the component gathers
 * the facts in an effect and passes them in. That is not tidiness. The test
 * suite runs in Node with no DOM (vitest.config.ts), so the only way to check
 * these rules against real user-agent strings is for them to be a function
 * over plain data — and the rules are the part that goes wrong.
 *
 * Nothing here looks at an iOS *version*. Safari freezes and reduces what it
 * reports, so a version branch would rot silently and take the install
 * instructions with it.
 */

export type ClientOs = "IOS" | "IPADOS" | "ANDROID" | "MACOS" | "WINDOWS" | "OTHER";
export type ClientBrowser = "SAFARI" | "CHROME" | "EDGE" | "SAMSUNG" | "FIREFOX" | "OPERA" | "OTHER";

export interface PlatformFacts {
  userAgent: string;
  /** Touch points. An iPad asking for the desktop site is a Mac apart from this. */
  maxTouchPoints: number;
}

export interface DetectedPlatform {
  os: ClientOs;
  browser: ClientBrowser;
  /**
   * A browser embedded in another app — Instagram, Facebook, LinkedIn. It
   * renders with a real engine and inherits that engine's user agent, but it
   * cannot install anything and usually has no visible Share control.
   */
  inApp: boolean;
}

/**
 * How this client installs, if they can.
 *
 * - `ios-safari`      Share, then Add to Home Screen
 * - `ios-elsewhere`   another browser or an embedded one: open in Safari first
 * - `android-prompt`  the browser offered us a real install prompt
 * - `android-menu`    no prompt offered: the browser's own menu
 * - `android-elsewhere` an embedded browser: open in Chrome first
 * - `desktop-prompt`  a desktop browser that offered a prompt
 * - `desktop-manual`  macOS Safari: Add to Dock, by hand
 * - `desktop-qr`      no install here at all — send them to their phone
 */
export type InstallFlow =
  | "ios-safari"
  | "ios-elsewhere"
  | "android-prompt"
  | "android-menu"
  | "android-elsewhere"
  | "desktop-prompt"
  | "desktop-manual"
  | "desktop-qr";

/** Tokens an embedded browser leaves behind. Many leave none — see `detectPlatform`. */
const IN_APP_TOKENS = [
  "FBAN", // Facebook
  "FBAV",
  "FB_IAB",
  "Instagram",
  "LinkedInApp",
  "Line/",
  "Twitter",
  "Snapchat",
  "Pinterest",
  "WhatsApp",
  "MicroMessenger", // WeChat
  "GSA/", // the Google app
];

const has = (ua: string, token: string) => ua.toLowerCase().includes(token.toLowerCase());

/**
 * What the user agent says, read in an order that matters.
 *
 * Embedded browsers are checked first: they carry the host engine's tokens,
 * so asking "is this Chrome?" first would call Instagram's viewer Chrome and
 * offer it an install it cannot do.
 *
 * Safari is checked last for the mirror-image reason: every browser on iOS is
 * WebKit and every one of them says `Safari`. Only the absence of the others'
 * markers means it really is Safari.
 */
export function detectPlatform({ userAgent, maxTouchPoints }: PlatformFacts): DetectedPlatform {
  const ua = userAgent ?? "";

  // An iPad asking for the desktop site calls itself a Mac. A real Mac has no
  // touch points; this is the ordinary case on iPad, not an edge case.
  const isIpad = has(ua, "iPad") || (has(ua, "Macintosh") && maxTouchPoints > 1);
  const isIphone = has(ua, "iPhone") || has(ua, "iPod");
  const isAndroid = has(ua, "Android");

  const os: ClientOs = isIpad
    ? "IPADOS"
    : isIphone
      ? "IOS"
      : isAndroid
        ? "ANDROID"
        : has(ua, "Macintosh")
          ? "MACOS"
          : has(ua, "Windows")
            ? "WINDOWS"
            : "OTHER";

  // `; wv)` is Android's own marker for a WebView, which an app embeds.
  const inApp = IN_APP_TOKENS.some((token) => has(ua, token)) || /;\s*wv\)/i.test(ua);

  const browser: ClientBrowser = has(ua, "SamsungBrowser")
    ? "SAMSUNG"
    : has(ua, "EdgiOS") || has(ua, "EdgA") || has(ua, "Edg/")
      ? "EDGE"
      : has(ua, "OPiOS") || has(ua, "OPR/") || has(ua, "Opera")
        ? "OPERA"
        : has(ua, "FxiOS") || has(ua, "Firefox")
          ? "FIREFOX"
          : has(ua, "CriOS") || has(ua, "Chrome") || has(ua, "Chromium")
            ? "CHROME"
            : has(ua, "Safari")
              ? "SAFARI"
              : "OTHER";

  return { os, browser, inApp };
}

/** True for an iPhone or an iPad, however the iPad is describing itself. */
export function isApplePhoneOrTablet(platform: DetectedPlatform): boolean {
  return platform.os === "IOS" || platform.os === "IPADOS";
}

/**
 * Which set of instructions to show.
 *
 * `hasInstallPrompt` is whether the browser has handed us a
 * `beforeinstallprompt` event. It is not a property of the device: the event
 * arrives late or never, so the component waits a moment and then decides
 * once — see components/client-app/install-nudge.tsx.
 *
 * The unknown case fails towards the recoverable instruction. Telling a
 * client to look for a Share control that is not there leaves them stuck;
 * telling them to open the page in Safari or Chrome always works, even when
 * it was not strictly necessary. That rule is tested.
 */
export function installFlowFor(platform: DetectedPlatform, { hasInstallPrompt }: { hasInstallPrompt: boolean }): InstallFlow {
  if (isApplePhoneOrTablet(platform)) {
    // On iOS only Safari proper can add to the Home Screen. We cannot tell
    // Safari apart from an in-app Safari view (SFSafariViewController), which
    // looks all but identical and cannot install — so anything that is not
    // plainly Safari gets the recoverable instruction.
    return platform.browser === "SAFARI" && !platform.inApp ? "ios-safari" : "ios-elsewhere";
  }

  if (platform.os === "ANDROID") {
    if (platform.inApp) return "android-elsewhere";
    return hasInstallPrompt ? "android-prompt" : "android-menu";
  }

  if (hasInstallPrompt) return "desktop-prompt";
  // macOS Safari installs through File > Add to Dock. Everything else on a
  // desktop — Firefox above all — cannot install at all, so the useful thing
  // is to get the app onto their phone instead.
  if (platform.os === "MACOS" && platform.browser === "SAFARI") return "desktop-manual";
  return "desktop-qr";
}
