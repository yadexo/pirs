"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Icon, QrCode } from "@/components/client-app/ui";
import { chooseNudge, type NudgeHistory, type NudgeSurface } from "@/lib/install-nudge";
import { detectPlatform, installFlowFor, type DetectedPlatform, type InstallFlow } from "@/lib/install-platform";
import { clientRecordInstallEventAction } from "@/lib/actions/client-app";

/**
 * "Add this clinic's app to your Home Screen", asked the way the client's own
 * browser actually does it.
 *
 * Every rule lives somewhere else on purpose: whether to ask in
 * lib/install-nudge.ts, and what this device can do in lib/install-platform.ts.
 * Both are pure and tested. What is left here is a screen.
 *
 * It nudges and then stops. Both surfaces close, nothing is ever trapped
 * behind them, and "Don't ask again" sits next to the install button — a
 * client who would rather stay in the browser can, for good, and keep
 * booking, ordering and paying.
 *
 * Every step of a flow stays on screen together rather than being paged
 * through. On iOS the client has to leave this page — down into Safari's own
 * toolbar and then a system menu — and a paged walkthrough would hide step 2
 * at the moment they need it.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const sessionKey = (slug: string) => `install-nudge-shown:${slug}`;

/**
 * How long to wait for `beforeinstallprompt` before deciding what to show.
 *
 * That event is the only reliable sign a browser will install for us, and it
 * arrives after first paint — sometimes well after. Deciding without waiting
 * would show an Android client the long "use the browser menu" steps a moment
 * before their browser offered to do it in one tap.
 */
const PROMPT_GRACE_MS = 1200;

export function InstallNudge({
  merchantSlug,
  merchantName,
  logoUrl,
  enabled,
  history,
}: {
  merchantSlug: string;
  merchantName: string;
  logoUrl: string | null;
  enabled: boolean;
  history: NudgeHistory;
}) {
  const t = useTranslations("clientApp.installNudge");
  const [facts, setFacts] = React.useState<{ platform: DetectedPlatform; standalone: boolean; shownThisSession: boolean } | null>(null);
  const [flow, setFlow] = React.useState<InstallFlow | null>(null);
  const [closed, setClosed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const deferred = React.useRef<BeforeInstallPromptEvent | null>(null);
  const reported = React.useRef(false);

  // Nothing is read from the browser during render: the server rendered this
  // markup too, and it knows none of it.
  React.useEffect(() => {
    const platform = detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let shownThisSession = false;
    try {
      shownThisSession = sessionStorage.getItem(sessionKey(merchantSlug)) === "1";
    } catch {
      // Storage blocked. Asking twice in one sitting is a smaller failure than
      // never asking at all, so carry on as if nothing had been shown.
    }
    setFacts({ platform, standalone, shownThisSession });
    setUrl(window.location.href);

    const onPrompt = (event: Event) => {
      // Keeping the event is what lets our own button install later. Without
      // preventDefault the browser also shows its own bar.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setFlow(installFlowFor(platform, { hasInstallPrompt: true }));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const settle = window.setTimeout(() => {
      setFlow((current) => current ?? installFlowFor(platform, { hasInstallPrompt: deferred.current !== null }));
    }, PROMPT_GRACE_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(settle);
    };
  }, [merchantSlug]);

  const choice = facts && !closed ? chooseNudge({ ...facts, enabled, history, now: Date.now() }) : null;
  const surface: NudgeSurface | null = choice?.surface ?? null;
  const stage = choice?.stage ?? 0;

  const record = React.useCallback(
    (kind: "SHOWN" | "STARTED" | "ACCEPTED" | "DISMISSED" | "NEVER") => {
      if (!facts) return;
      void clientRecordInstallEventAction(merchantSlug, {
        kind,
        os: facts.platform.os,
        browser: facts.platform.browser,
        stage,
      }).catch(() => {
        // The clinic's tally is a courtesy. It never gets in the client's way.
      });
    },
    [facts, merchantSlug, stage],
  );

  // Once, and only once there is something the client can actually see.
  React.useEffect(() => {
    if (!surface || !flow || reported.current) return;
    reported.current = true;
    try {
      sessionStorage.setItem(sessionKey(merchantSlug), "1");
    } catch {
      /* ignore */
    }
    record("SHOWN");
  }, [surface, flow, record, merchantSlug]);

  if (!surface || !flow || !facts) return null;

  const dismiss = () => {
    setClosed(true);
    record("DISMISSED");
  };

  const never = () => {
    setClosed(true);
    record("NEVER");
  };

  const install = async () => {
    const event = deferred.current;
    if (!event) return;
    record("STARTED");
    setBusy(true);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      deferred.current = null;
      if (outcome === "accepted") {
        // Chrome says "accepted" before the install has finished, so this is a
        // hint, not proof — the install count is built from the app being
        // opened (lib/install-nudge-data.ts). Either way, stop asking.
        record("ACCEPTED");
        setClosed(true);
      } else {
        dismiss();
      }
    } catch {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    record("STARTED");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard permission: the address is on screen to read instead.
      setCopied(false);
    }
  };

  const openIn = flow === "android-elsewhere" ? "Chrome" : "Safari";
  const canPrompt = flow === "android-prompt" || flow === "desktop-prompt";

  if (surface === "banner") {
    return (
      <div className="ca-install" role="region" aria-label={t("addTo", { name: merchantName })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="ca-install-title">{t("addTo", { name: merchantName })}</p>
          <p className="ca-install-body">
            <ShortInstruction flow={flow} os={facts.platform.os} browser={openIn} />
          </p>
        </div>
        {canPrompt && (
          <button type="button" className="btn-black ca-install-btn" disabled={busy} onClick={() => void install()}>
            {busy ? t("working") : t("install")}
          </button>
        )}
        <button type="button" className="ca-iconbtn" aria-label={t("notNow")} onClick={dismiss}>
          <Icon name="close" size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className="ovl ca-nudge" role="dialog" aria-modal="true" aria-label={t("addTo", { name: merchantName })}>
      <div className="oin">
        <button type="button" className="ca-iconbtn ca-nudge-close" aria-label={t("notNow")} onClick={dismiss}>
          <Icon name="close" size={20} />
        </button>

        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="onblogo" src={logoUrl} alt="" />
        ) : (
          <span className="onblogo ca-nudge-mark" aria-hidden="true">
            {merchantName.slice(0, 1).toUpperCase()}
          </span>
        )}

        <h2 className="ca-nudge-title">{flow === "desktop-qr" ? t("qrTitle") : t("addTo", { name: merchantName })}</h2>
        <p className="ca-nudge-why">{flow === "desktop-qr" ? t("qrBody", { name: merchantName }) : t("why")}</p>

        {flow === "desktop-qr" ? (
          <div className="ca-nudge-qr">
            <QrCode value={url} label={t("qrTitle")} />
          </div>
        ) : (
          <Steps flow={flow} os={facts.platform.os} browser={openIn} merchantName={merchantName} url={url} copied={copied} onCopy={() => void copyLink()} />
        )}

        {flow !== "desktop-qr" && <p className="ca-nudge-note">{t("signInAgain")}</p>}

        <div className="ca-nudge-actions">
          {canPrompt && (
            <button type="button" className="btn-black ca-nudge-cta" disabled={busy} onClick={() => void install()}>
              {busy ? t("working") : t("install")}
            </button>
          )}
          <button type="button" className="press ca-nudge-later" onClick={dismiss}>
            {t("notNow")}
          </button>
          <button type="button" className="press ca-nudge-never" onClick={never}>
            {t("never")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The steps, all of them, in the order the client will do them.
 *
 * The arrow is decoration: it points at where the control named in the step
 * lives, and every step reads correctly with the arrow standing still or
 * absent — which is what the reduced-motion rule leaves behind.
 */
function Steps({
  flow,
  os,
  browser,
  merchantName,
  url,
  copied,
  onCopy,
}: {
  flow: InstallFlow;
  os: DetectedPlatform["os"];
  browser: string;
  merchantName: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = useTranslations("clientApp.installNudge");
  const share = () => <Icon name="share" size={16} />;
  const bold = (chunks: React.ReactNode) => <b>{chunks}</b>;

  if (flow === "ios-safari") {
    // Safari puts Share in the bottom toolbar on an iPhone and at the top
    // right on an iPad, so the arrow has to know which it is pointing at.
    const pad = os === "IPADOS";
    return (
      <>
        <ol className="ca-nudge-steps">
          <li>{t.rich(pad ? "iosStep1Pad" : "iosStep1", { icon: share, b: bold })}</li>
          <li>{t.rich("iosStep2", { b: bold })}</li>
          <li>{t.rich("iosStep3", { name: merchantName, b: bold })}</li>
        </ol>
        <Arrow direction={pad ? "up" : "down"} />
      </>
    );
  }

  if (flow === "android-menu") {
    return (
      <>
        <ol className="ca-nudge-steps">
          <li>{t.rich("menuStep1", { b: bold })}</li>
          <li>{t.rich("menuStep2", { b: bold })}</li>
        </ol>
        <Arrow direction="up" />
      </>
    );
  }

  if (flow === "desktop-manual") {
    return (
      <ol className="ca-nudge-steps">
        <li>{t.rich("dockStep1", { b: bold })}</li>
        <li>{t.rich("dockStep2", { b: bold })}</li>
      </ol>
    );
  }

  if (flow === "ios-elsewhere" || flow === "android-elsewhere") {
    return (
      <div className="ca-nudge-elsewhere">
        <p className="ca-nudge-lead">{t("elsewhereBody", { browser })}</p>
        <button type="button" className="btn-black ca-nudge-cta" onClick={onCopy}>
          {copied ? t("copied") : t("copyLink")}
        </button>
        <p className="ca-nudge-url">{url}</p>
      </div>
    );
  }

  // A browser that will do it for us: the button below is the whole story.
  return <p className="ca-nudge-lead">{t("promptBody")}</p>;
}

/** Points at the control named in the step above. Decorative, and silent. */
function Arrow({ direction }: { direction: "up" | "down" }) {
  return (
    <span className={`ca-nudge-arrow ${direction}`} aria-hidden="true">
      <svg width="26" height="40" viewBox="0 0 26 40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 3v33" />
        <path d="m5 29 8 8 8-8" />
      </svg>
    </span>
  );
}

/** One line for the banner: the same instruction, run together. */
function ShortInstruction({ flow, os, browser }: { flow: InstallFlow; os: DetectedPlatform["os"]; browser: string }) {
  const t = useTranslations("clientApp.installNudge");
  const rich = (key: string) => t.rich(key, { icon: () => <Icon name="share" size={15} />, b: (chunks) => <b>{chunks}</b> });

  if (flow === "ios-safari") return <>{rich(os === "IPADOS" ? "shortIosPad" : "shortIos")}</>;
  if (flow === "android-menu") return <>{t("shortMenu")}</>;
  if (flow === "desktop-manual") return <>{t("shortDock")}</>;
  if (flow === "ios-elsewhere" || flow === "android-elsewhere") return <>{t("elsewhereBody", { browser })}</>;
  if (flow === "desktop-qr") return <>{t("shortQr")}</>;
  return <>{t("promptBody")}</>;
}
