import { describe, it, expect } from "vitest";
import { detectPlatform, installFlowFor, isApplePhoneOrTablet, type InstallFlow, type PlatformFacts } from "@/lib/install-platform";

/**
 * Real user-agent strings, because the rules that go wrong are the ones about
 * which token wins — and a made-up string proves nothing about Instagram's
 * viewer calling itself Safari.
 */
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0.2592.87 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.32.98 (iPhone14,2; iOS 17_5; en_GB)",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/466.0.0.36.107]",
  iphoneLinkedIn:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.29.0",
  iphoneGoogleApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/303.0.613463504 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  /** iPad asking for the desktop site — the default on iPad, and it claims to be a Mac. */
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.87",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36",
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 334.0.0.32.98 Android",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
} as const;

const phone = (userAgent: string): PlatformFacts => ({ userAgent, maxTouchPoints: 5 });
const desktop = (userAgent: string): PlatformFacts => ({ userAgent, maxTouchPoints: 0 });
const flow = (facts: PlatformFacts, hasInstallPrompt = false): InstallFlow => installFlowFor(detectPlatform(facts), { hasInstallPrompt });

describe("reading the device", () => {
  it("knows an iPhone from its browser", () => {
    expect(detectPlatform(phone(UA.iphoneSafari))).toEqual({ os: "IOS", browser: "SAFARI", inApp: false });
    expect(detectPlatform(phone(UA.iphoneChrome))).toEqual({ os: "IOS", browser: "CHROME", inApp: false });
    expect(detectPlatform(phone(UA.iphoneFirefox))).toEqual({ os: "IOS", browser: "FIREFOX", inApp: false });
    expect(detectPlatform(phone(UA.iphoneEdge))).toEqual({ os: "IOS", browser: "EDGE", inApp: false });
  });

  it("does not call every iOS browser Safari, though they all say so", () => {
    // Chrome and Firefox on iOS are WebKit and carry "Safari" in the string.
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge]) {
      expect(ua).toContain("Safari");
      expect(detectPlatform(phone(ua)).browser).not.toBe("SAFARI");
    }
  });

  it("spots the embedded browsers that leave a token", () => {
    for (const ua of [UA.iphoneInstagram, UA.iphoneFacebook, UA.iphoneLinkedIn, UA.iphoneGoogleApp, UA.androidInstagram, UA.androidWebView]) {
      expect(detectPlatform(phone(ua)).inApp, ua.slice(0, 60)).toBe(true);
    }
    for (const ua of [UA.iphoneSafari, UA.androidChrome, UA.windowsChrome]) {
      expect(detectPlatform(phone(ua)).inApp).toBe(false);
    }
  });

  it("reads an iPad as an iPad even when it claims to be a Mac", () => {
    // "Request Desktop Website" is the default on iPad, so this is the normal
    // case. The only thing separating it from a real Mac is the touch points.
    expect(UA.ipadDesktopMode).toBe(UA.macSafari);
    expect(detectPlatform({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 }).os).toBe("IPADOS");
    expect(detectPlatform({ userAgent: UA.macSafari, maxTouchPoints: 0 }).os).toBe("MACOS");
    expect(detectPlatform(phone(UA.ipadSafari)).os).toBe("IPADOS");
  });

  it("knows the Android browsers apart", () => {
    expect(detectPlatform(phone(UA.androidChrome))).toMatchObject({ os: "ANDROID", browser: "CHROME" });
    expect(detectPlatform(phone(UA.androidSamsung))).toMatchObject({ os: "ANDROID", browser: "SAMSUNG" });
    expect(detectPlatform(phone(UA.androidFirefox))).toMatchObject({ os: "ANDROID", browser: "FIREFOX" });
    // Edge on Android says Chrome too, and comes after it in the string.
    expect(detectPlatform(phone(UA.androidEdge))).toMatchObject({ os: "ANDROID", browser: "EDGE" });
  });

  it("knows the desktops apart", () => {
    expect(detectPlatform(desktop(UA.windowsChrome))).toMatchObject({ os: "WINDOWS", browser: "CHROME" });
    expect(detectPlatform(desktop(UA.windowsEdge))).toMatchObject({ os: "WINDOWS", browser: "EDGE" });
    expect(detectPlatform(desktop(UA.windowsFirefox))).toMatchObject({ os: "WINDOWS", browser: "FIREFOX" });
    expect(detectPlatform(desktop(UA.macChrome))).toMatchObject({ os: "MACOS", browser: "CHROME" });
    expect(detectPlatform(desktop(UA.macSafari))).toMatchObject({ os: "MACOS", browser: "SAFARI" });
  });

  it("says something sensible about a string it has never seen", () => {
    expect(detectPlatform({ userAgent: "", maxTouchPoints: 0 })).toEqual({ os: "OTHER", browser: "OTHER", inApp: false });
    expect(detectPlatform({ userAgent: "SomeNewBrowser/1.0", maxTouchPoints: 0 }).os).toBe("OTHER");
  });

  it("counts both kinds of Apple handheld as one", () => {
    expect(isApplePhoneOrTablet(detectPlatform(phone(UA.iphoneSafari)))).toBe(true);
    expect(isApplePhoneOrTablet(detectPlatform(phone(UA.ipadSafari)))).toBe(true);
    expect(isApplePhoneOrTablet(detectPlatform(desktop(UA.macSafari)))).toBe(false);
  });
});

describe("which instructions a client gets", () => {
  it("shows the Share steps only in Safari proper", () => {
    expect(flow(phone(UA.iphoneSafari))).toBe("ios-safari");
    expect(flow({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("sends every other iOS browser to Safari first", () => {
    // None of these can add to the Home Screen, and telling them to look for
    // a Share button they do not have leaves them stuck.
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge, UA.iphoneInstagram, UA.iphoneFacebook, UA.iphoneLinkedIn, UA.iphoneGoogleApp]) {
      expect(flow(phone(ua)), ua.slice(0, 60)).toBe("ios-elsewhere");
    }
  });

  it("offers one tap on Android when the browser offered us a prompt", () => {
    expect(flow(phone(UA.androidChrome), true)).toBe("android-prompt");
    expect(flow(phone(UA.androidSamsung), true)).toBe("android-prompt");
  });

  it("falls back to the browser's own menu when no prompt arrived", () => {
    expect(flow(phone(UA.androidChrome), false)).toBe("android-menu");
    expect(flow(phone(UA.androidFirefox), false)).toBe("android-menu");
  });

  it("sends an embedded Android browser to Chrome, prompt or not", () => {
    expect(flow(phone(UA.androidInstagram), false)).toBe("android-elsewhere");
    expect(flow(phone(UA.androidWebView), true)).toBe("android-elsewhere");
  });

  it("installs on a desktop that offers it, and sends the rest to their phone", () => {
    expect(flow(desktop(UA.windowsChrome), true)).toBe("desktop-prompt");
    expect(flow(desktop(UA.windowsEdge), true)).toBe("desktop-prompt");
    // Firefox on a desktop cannot install at all.
    expect(flow(desktop(UA.windowsFirefox), false)).toBe("desktop-qr");
  });

  it("tells macOS Safari about Add to Dock rather than showing it a QR code", () => {
    expect(flow(desktop(UA.macSafari), false)).toBe("desktop-manual");
    // Chrome on a Mac is an ordinary prompt when one is offered.
    expect(flow(desktop(UA.macChrome), true)).toBe("desktop-prompt");
  });

  it("fails towards the instruction that always works", () => {
    // An unknown browser on an unknown system: a QR code is useless advice
    // but harmless, where "tap Share" would be a dead end. Nothing here ever
    // claims an install that cannot happen.
    expect(flow({ userAgent: "SomeNewBrowser/1.0", maxTouchPoints: 0 }, false)).toBe("desktop-qr");
    expect(flow({ userAgent: "", maxTouchPoints: 0 }, false)).toBe("desktop-qr");
    // An unknown browser that is plainly on an iPhone still gets the one
    // instruction that works there.
    expect(flow({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) SomethingNew/2.0", maxTouchPoints: 5 })).toBe("ios-elsewhere");
  });
});
