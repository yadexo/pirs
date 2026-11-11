"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Icon, Sheet } from "@/components/client-app/ui";
import { Button } from "@/components/client-app/v2";
import { isIos, isStandalone } from "@/components/client-app/pwa";
import { clientRecordNotificationPromptAction } from "@/lib/actions/client-app";
import { choosePrompt, type PromptHistory, type PromptSurface, type PushState } from "@/lib/notification-prompt";

/**
 * Turning notifications on, and the places a client can do it: a bottom sheet
 * on their first Home visit, a smaller card that comes back after a "Not now",
 * and a row in Profile → Settings. When to show which is decided by
 * lib/notification-prompt.ts, which is pure and has its own tests.
 *
 * Permission is only ever asked for after a tap. Browsers hold it against a
 * site that asks on load — and iOS refuses outright unless the request comes
 * from a gesture inside an installed app, which is why a Safari tab reports
 * "install-first" rather than offering a button that cannot work.
 */

/** The push service wants the key as bytes, not the base64url the server sends. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function post(action: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string; message?: string }> {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { ok: res.ok, error: data.error, message: data.message };
}

/** Where a tap happened, for the clinic's tally. */
type TapSurface = "SHEET" | "CARD" | "SETTINGS";
/** What asking the device for permission came to. */
type EnableResult = "on" | "denied" | "dismissed" | "error";

export function usePush() {
  const t = useTranslations("clientApp.notifications");
  const [state, setState] = React.useState<PushState>("loading");
  const [permission, setPermission] = React.useState<NotificationPermission | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const keyRef = React.useRef<string | null>(null);

  const read = React.useCallback(async () => {
    // An iPhone only has push inside an installed app, so say that rather than
    // "your browser can't".
    if (isIos() && !isStandalone()) {
      setState("install-first");
      return;
    }
    if (!supported()) {
      setState("unsupported");
      return;
    }
    try {
      const res = await fetch("/api/push");
      const data = (await res.json()) as { configured: boolean; publicKey: string | null };
      if (!data.configured || !data.publicKey) {
        setState("unconfigured");
        return;
      }
      keyRef.current = data.publicKey;
    } catch {
      setState("unconfigured");
      return;
    }
    setPermission(Notification.permission);
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    setState(existing && Notification.permission === "granted" ? "on" : "off");
  }, []);

  React.useEffect(() => {
    void read();
  }, [read]);

  const enable = React.useCallback(
    async (surface: TapSurface = "SETTINGS"): Promise<EnableResult> => {
      setBusy(true);
      setMessage(null);
      try {
        const answer = await Notification.requestPermission();
        setPermission(answer);
        if (answer === "denied") {
          setState("denied");
          return "denied";
        }
        // Closed without choosing: nothing was decided, so nothing changes.
        if (answer !== "granted") return "dismissed";

        const registration = await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            // Required by the browser, and true here: every push shows something.
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyRef.current!) as BufferSource,
          }));

        const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const res = await post("subscribe", { endpoint: json.endpoint, keys: json.keys, surface });
        if (!res.ok) {
          setMessage(res.error ?? t("failed"));
          return "error";
        }
        setState("on");
        return "on";
      } catch {
        setMessage(t("deviceFailed"));
        return "error";
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const disable = React.useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await post("unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setMessage(t("disableFailed"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const sendTest = React.useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const res = await post("test");
    setMessage(res.ok ? (res.message ?? t("testSent")) : (res.error ?? t("testFailed")));
    setBusy(false);
  }, [t]);

  return { state, permission, busy, message, enable, disable, sendTest };
}

const SURFACE: Record<PromptSurface, "SHEET" | "CARD" | "SETTINGS_HELP"> = {
  sheet: "SHEET",
  card: "CARD",
  "settings-help": "SETTINGS_HELP",
};

/**
 * Home: asks a client who hasn't decided to turn notifications on, in the
 * shape that fits — a sheet on the first visit in the installed app, a card
 * after that, a how-to when the device said no. Renders nothing the rest of
 * the time, and never for a client who already granted or denied the device's
 * own permission.
 *
 * Getting the app installed is the install nudge's job
 * (components/client-app/install-nudge.tsx), not this one's.
 */
export function NotificationPrompt({ merchantSlug, clinicName, history }: { merchantSlug: string; clinicName: string; history: PromptHistory }) {
  const t = useTranslations("clientApp.notifications");
  const { state, permission, busy, message, enable } = usePush();
  const [standalone, setStandalone] = React.useState(false);
  // Closed by the client just now. The server catches up on the next render.
  const [closed, setClosed] = React.useState(false);
  // The device just said no to the prompt we put up: say how to undo it, in place.
  const [blockedOn, setBlockedOn] = React.useState<"sheet" | "card" | null>(null);
  const [sheetReady, setSheetReady] = React.useState(false);
  const reported = React.useRef(new Set<string>());

  React.useEffect(() => {
    setStandalone(isStandalone());
  }, []);

  const choice = closed ? null : choosePrompt({ state, permission, standalone, history, now: Date.now() });
  const surface = choice?.surface;
  const stage = choice?.stage ?? 0;

  const report = React.useCallback(
    (kind: "SHOWN" | "NOT_NOW" | "BLOCKED", on: PromptSurface, at: number) => {
      void clientRecordNotificationPromptAction(merchantSlug, { kind, surface: SURFACE[on], stage: at }).catch(() => {
        // The tally is a courtesy; it must never get in the client's way.
      });
    },
    [merchantSlug],
  );

  // Let the launch screen finish before a sheet comes up over it.
  const wantsSheet = surface === "sheet";
  React.useEffect(() => {
    if (!wantsSheet) return;
    const id = window.setTimeout(() => setSheetReady(true), 900);
    return () => window.clearTimeout(id);
  }, [wantsSheet]);

  // Once per step of the schedule, and only when the client could actually see it.
  React.useEffect(() => {
    if (!surface || (surface === "sheet" && !sheetReady)) return;
    const key = `${surface}:${stage}`;
    if (reported.current.has(key)) return;
    reported.current.add(key);
    report("SHOWN", surface, stage);
  }, [surface, stage, sheetReady, report]);

  const notNow = (on: PromptSurface) => {
    setClosed(true);
    report("NOT_NOW", on, stage);
  };

  const turnOn = async (on: "sheet" | "card") => {
    const result = await enable(on === "sheet" ? "SHEET" : "CARD");
    if (result === "denied") {
      report("BLOCKED", on, stage);
      setBlockedOn(on);
    }
  };

  const closeHelp = () => {
    setBlockedOn(null);
    setClosed(true);
  };

  const offers = history.offersDecided ? t("offersDecided") : t("offersDefault");

  // --- the sheet -----------------------------------------------------------
  if (blockedOn === "sheet" || (surface === "sheet" && !blockedOn)) {
    const blocked = blockedOn === "sheet";
    return (
      <Sheet
        open={blocked || sheetReady}
        onClose={blocked ? closeHelp : () => notNow("sheet")}
        title={blocked ? t("deniedTitle") : t("sheetTitle")}
        cta={
          blocked ? (
            <Button variant="primary" onClick={closeHelp}>
              {t("gotIt")}
            </Button>
          ) : (
            <div className="ca-pushsheet-actions">
              <Button variant="primary" disabled={busy} onClick={() => void turnOn("sheet")}>
                {busy ? t("working") : t("turnOn")}
              </Button>
              <Button variant="grey" disabled={busy} onClick={() => notNow("sheet")}>
                {t("notNow")}
              </Button>
            </div>
          )
        }
      >
        <div className="ca-pushsheet">
          <span className="ca-pushsheet-icon" aria-hidden="true">
            <Icon name="bell" size={28} />
          </span>
          <p className="ca-pushsheet-body">{blocked ? t("deniedSteps") : t("sheetBody", { name: clinicName })}</p>
          {!blocked && <p className="ca-pushsheet-note">{offers}</p>}
          {message && (
            <p className="ca-pushsheet-note" role="alert">
              {message}
            </p>
          )}
        </div>
      </Sheet>
    );
  }

  // --- the cards -----------------------------------------------------------
  if (blockedOn === "card" || surface === "card" || surface === "settings-help") {
    const help = blockedOn === "card" || surface === "settings-help";

    const title = help ? t("deniedTitle") : t("cardTitle");
    const onClose = help ? (blockedOn ? closeHelp : () => notNow("settings-help")) : () => notNow("card");

    return (
      <div className="ca-pushcard" role="region" aria-label={title}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="ca-pushcard-title">{title}</p>
          <p className="ca-pushcard-body">{help ? t("deniedSteps") : `${t("sheetBody", { name: clinicName })} ${offers}`}</p>
          {message && (
            <p className="ca-pushcard-body" role="alert">
              {message}
            </p>
          )}
          {!help && (
            <button className="btn-black ca-pushcard-action" type="button" onClick={() => void turnOn("card")} disabled={busy}>
              {busy ? t("working") : t("turnOn")}
            </button>
          )}
        </div>
        <button type="button" className="ca-iconbtn ca-pushcard-close" aria-label={t("close")} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
    );
  }

  return null;
}

/** Profile → Settings: the switch, and a way to prove it works. */
export function NotificationSettings() {
  const t = useTranslations("clientApp.notifications");
  const { state, busy, message, enable, disable, sendTest } = usePush();

  const explanation =
    state === "on"
      ? t("settingsOn")
      : state === "install-first"
        ? t("settingsInstallFirst")
        : state === "denied"
          ? t("deniedSteps")
          : state === "unsupported"
            ? t("settingsUnsupported")
            : state === "unconfigured"
              ? t("settingsUnconfigured")
              : t("settingsOff");

  return (
    <div className="ca-pushsettings">
      <div className="row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="ca-pushcard-title">{t("settingsTitle")}</p>
          <p className="ca-pushcard-body">{explanation}</p>
        </div>
        {(state === "off" || state === "on") && (
          <button
            type="button"
            role="switch"
            aria-checked={state === "on"}
            aria-label={t("switchLabel")}
            className={state === "on" ? "ca-switch on" : "ca-switch"}
            onClick={state === "on" ? () => void disable() : () => void enable("SETTINGS")}
            disabled={busy}
          >
            <span className="knob" />
          </button>
        )}
      </div>
      {state === "on" && (
        <button type="button" className="press ca-pushtest" onClick={() => void sendTest()} disabled={busy}>
          {busy ? t("sending") : t("sendTest")}
        </button>
      )}
      {message && <p className="ca-pushcard-body">{message}</p>}
    </div>
  );
}
