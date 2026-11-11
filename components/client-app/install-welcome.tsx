"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/client-app/ui";
import { isStandalone } from "@/components/client-app/pwa";
import { clientRecordInstallEventAction } from "@/lib/actions/client-app";
import { detectPlatform } from "@/lib/install-platform";

/**
 * The first open of the installed app: say hello, once, and record that it
 * happened.
 *
 * Recording it is the only way a clinic ever learns an install worked. iOS
 * fires no install event of any kind, and the one browser event that exists
 * (`appinstalled`) arrives in the tab the client installed *from*, not in the
 * app. "They opened it from the icon" is the only honest signal, so it is the
 * one the install count is built on (lib/install-nudge-data.ts).
 *
 * Why a welcome here and not straight after the install: an installed app
 * gets its own cookie jar and its own storage. The client taps the new icon
 * and lands on the sign-in screen, not on a welcome — nothing crossed over
 * from Safari. The first moment we can both greet them and know they are
 * installed is their first signed-in visit inside the app, which is this.
 *
 * `firstOpen` comes from the server, per address, so a second launch is
 * silent even on a different device.
 */
const openedKey = (slug: string) => `install-opened:${slug}`;

export function InstallWelcome({
  merchantSlug,
  merchantName,
  firstOpen,
  messageNl,
  messageEn,
  onOpen,
  onClose,
}: {
  merchantSlug: string;
  merchantName: string;
  firstOpen: boolean;
  messageNl: string | null;
  messageEn: string | null;
  /** Told as soon as the welcome is up, so Home can hold anything else back. */
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("clientApp.installWelcome");
  const locale = useLocale();
  const [show, setShow] = React.useState(false);
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current || !isStandalone()) return;
    fired.current = true;

    // Once a session, not once a visit to Home. Every row would be honest
    // either way — the count is of clients, not events — but a client walking
    // back and forth to Home would write one each time and spend their own
    // rate limit on it.
    let recordedAlready = false;
    try {
      recordedAlready = sessionStorage.getItem(openedKey(merchantSlug)) === "1";
      sessionStorage.setItem(openedKey(merchantSlug), "1");
    } catch {
      /* storage blocked: record it and accept the extra rows */
    }

    if (!recordedAlready) {
      const platform = detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
      void clientRecordInstallEventAction(merchantSlug, {
        kind: "OPENED",
        os: platform.os,
        browser: platform.browser,
        stage: 0,
      }).catch(() => {
        // The tally is a courtesy; a client is never held up by it.
      });
    }

    if (firstOpen) {
      setShow(true);
      onOpen();
    }
  }, [merchantSlug, firstOpen, onOpen]);

  if (!show) return null;

  // The clinic's own sentence when it wrote one for this language, and ours
  // when it did not. Empty is the same as unset: a clinic that clears the box
  // gets the default back rather than a blank space on their clients' screens.
  const written = (locale === "nl" ? messageNl : messageEn)?.trim();
  const body = written || t("body", { name: merchantName });

  const close = () => {
    setShow(false);
    onClose();
  };

  return (
    <div className="ovl ca-welcome" role="dialog" aria-modal="true" aria-label={t("title", { name: merchantName })}>
      <div className="oin">
        <span className="okring" aria-hidden="true">
          <Icon name="check" size={34} />
        </span>
        <h2 className="ca-welcome-title">{t("title", { name: merchantName })}</h2>
        <p className="ca-welcome-body">{body}</p>
        <div className="ca-welcome-actions">
          <button type="button" className="btn-black ca-nudge-cta" onClick={close}>
            {t("start")}
          </button>
        </div>
      </div>
    </div>
  );
}
