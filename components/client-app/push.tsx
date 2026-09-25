"use client";

import * as React from "react";
import { Icon } from "@/components/client-app/ui";
import { isIos, isStandalone } from "@/components/client-app/pwa";

/**
 * Turning notifications on, and the two places a client can do it: a card on
 * Home and a row in Profile → Settings.
 *
 * Permission is only ever asked for after a tap. Browsers hold it against a
 * site that asks on load — and iOS refuses outright unless the request comes
 * from a gesture inside an installed app, which is why a Safari tab is told to
 * install the app rather than shown a button that cannot work.
 */

type State =
  | "loading"
  | "unsupported" // no push in this browser at all
  | "install-first" // iPhone, but running in a Safari tab
  | "unconfigured" // the platform has no VAPID keys
  | "denied" // the client said no, and only iOS Settings can undo it
  | "off"
  | "on";

/** The push service wants the key as bytes, not the base64url the server sends. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function post(action: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}

export function usePush() {
  const [state, setState] = React.useState<State>("loading");
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

  const enable = React.useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission !== "granted") return;

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by the browser, and true here: every push shows something.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRef.current!) as BufferSource,
        }));

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await post("subscribe", { endpoint: json.endpoint, keys: json.keys });
      if (!res.ok) {
        setMessage(res.error ?? "That didn't work. Try again in a moment.");
        return;
      }
      setState("on");
    } catch {
      setMessage("This device wouldn't turn notifications on. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, []);

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
      setMessage("Couldn't turn them off here. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, []);

  const sendTest = React.useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const res = await post("test");
    setMessage(res.ok ? "Sent — it should arrive in a second." : (res.error ?? "That didn't send."));
    setBusy(false);
  }, []);

  return { state, busy, message, enable, disable, sendTest };
}

const DENIED_HELP =
  "Notifications are blocked for this app. To allow them: iPhone Settings, then Notifications, then this app, then Allow Notifications.";

/** Home: a card offering notifications, gone once they are on. */
export function NotificationCard({ clinicName }: { clinicName: string }) {
  const { state, busy, message, enable } = usePush();
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed || state === "loading" || state === "on" || state === "unsupported" || state === "unconfigured") return null;

  return (
    <div className="ca-pushcard">
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="ca-pushcard-title">{state === "install-first" ? "Install the app to get notifications" : "Turn on notifications"}</p>
        <p className="ca-pushcard-body">
          {state === "install-first"
            ? `Add ${clinicName} to your Home Screen first — iPhone only allows notifications inside an installed app.`
            : state === "denied"
              ? DENIED_HELP
              : `${clinicName} can tell you when an order is paid, a refund lands, or something new arrives.`}
        </p>
        {message && <p className="ca-pushcard-body">{message}</p>}
      </div>
      {state === "off" && (
        <button className="btn-black" type="button" onClick={enable} disabled={busy} style={{ whiteSpace: "nowrap", width: "auto", padding: "0 18px" }}>
          {busy ? "One moment…" : "Turn on"}
        </button>
      )}
      <button type="button" className="press" aria-label="Dismiss" onClick={() => setDismissed(true)} style={{ color: "var(--muted)" }}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/** Profile → Settings: the switch, and a way to prove it works. */
export function NotificationSettings() {
  const { state, busy, message, enable, disable, sendTest } = usePush();

  const explanation =
    state === "on"
      ? "On for this device."
      : state === "install-first"
        ? "Add this app to your Home Screen to get notifications on iPhone."
        : state === "denied"
          ? DENIED_HELP
          : state === "unsupported"
            ? "This browser can't show notifications."
            : state === "unconfigured"
              ? "Notifications aren't available yet."
              : "Off for this device.";

  return (
    <div className="ca-pushsettings">
      <div className="row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="ca-pushcard-title">Notification preferences</p>
          <p className="ca-pushcard-body">{explanation}</p>
        </div>
        {(state === "off" || state === "on") && (
          <button
            type="button"
            role="switch"
            aria-checked={state === "on"}
            aria-label="Notifications"
            className={state === "on" ? "ca-switch on" : "ca-switch"}
            onClick={state === "on" ? disable : enable}
            disabled={busy}
          >
            <span className="knob" />
          </button>
        )}
      </div>
      {state === "on" && (
        <button type="button" className="press ca-pushtest" onClick={sendTest} disabled={busy}>
          {busy ? "Sending…" : "Send test notification"}
        </button>
      )}
      {message && <p className="ca-pushcard-body">{message}</p>}
    </div>
  );
}
