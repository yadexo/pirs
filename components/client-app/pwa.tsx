"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/client-app/ui";

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

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

const dismissKey = (slug: string) => `install-dismissed:${slug}`;

/**
 * "Add {clinic} to your Home Screen". Chrome and Android install in one tap;
 * iPhone has no install API, so it explains the Share-sheet steps. Shown on
 * Home only, never when already installed, and gone for 30 days once closed.
 */
export function InstallPrompt({ base, merchantSlug, merchantName }: { base: string; merchantSlug: string; merchantName: string }) {
  const t = useTranslations("clientApp.install");
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

  if (!mode || (pathname !== base && pathname !== `/app/${merchantSlug}`)) return null;

  const title = t("addToHomeScreen", { name: merchantName });
  return (
    <div className="ca-install" role="dialog" aria-label={title}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="ca-install-title">{title}</p>
        {mode === "ios" ? (
          <p className="ca-install-body">
            {t.rich("iosInstructions", {
              icon: () => <Icon name="share" size={15} />,
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        ) : (
          <p className="ca-install-body">{t("openLikeAnApp")}</p>
        )}
      </div>
      {mode === "android" && (
        <button type="button" className="btn-black ca-install-btn" onClick={install}>
          {t("install")}
        </button>
      )}
      <button type="button" className="ca-iconbtn" aria-label={t("close")} onClick={close}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}
