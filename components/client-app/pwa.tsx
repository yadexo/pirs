"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/client-app/ui";

/** Registers the clients' service worker (offline page, fast relaunch, push). */
export function ServiceWorker() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/client-sw.js", { scope: "/app/" }).catch(() => {});
  }, []);
  return null;
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

const dismissKey = (slug: string) => `install-dismissed:${slug}`;

/**
 * "Add {clinic} to your Home Screen". Chrome and Android install in one tap;
 * iPhone has no install API, so it explains the Share-sheet steps. Shown on
 * Home only, never when already installed, and gone for 30 days once closed.
 */
export function InstallPrompt({ merchantSlug, merchantName }: { merchantSlug: string; merchantName: string }) {
  const pathname = usePathname();
  const [mode, setMode] = React.useState<"android" | "ios" | null>(null);
  const deferred = React.useRef<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (isStandalone()) return;
    try {
      const at = Number(localStorage.getItem(dismissKey(merchantSlug)) ?? 0);
      if (Date.now() - at < 30 * 864e5) return;
    } catch {
      /* storage blocked: still offer */
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (isIos()) setMode("ios");
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [merchantSlug]);

  function close() {
    setMode(null);
    try {
      localStorage.setItem(dismissKey(merchantSlug), String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  async function install() {
    const e = deferred.current;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred.current = null;
    if (outcome === "accepted") setMode(null);
    else close();
  }

  if (!mode || pathname !== `/app/${merchantSlug}`) return null;

  return (
    <div className="ca-install" role="dialog" aria-label={`Add ${merchantName} to your Home Screen`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="ca-install-title">Add {merchantName} to your Home Screen</p>
        {mode === "ios" ? (
          <p className="ca-install-body">
            Tap <Icon name="share" size={15} /> Share, then <b>Add to Home Screen</b>.
          </p>
        ) : (
          <p className="ca-install-body">Open it like an app, with your rewards one tap away.</p>
        )}
      </div>
      {mode === "android" && (
        <button type="button" className="btn-black ca-install-btn" onClick={install}>
          Install
        </button>
      )}
      <button type="button" className="ca-iconbtn" aria-label="Close" onClick={close}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}
