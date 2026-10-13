"use client";

import * as React from "react";
import { Icon, QrCode, money } from "@/components/client-app/ui";
import { Tag } from "@/components/client-app/v2";
import { mintScanTokenAction } from "@/lib/actions/client-scan";

/**
 * The code a client shows at the desk.
 *
 * The screen's one job is to be scannable, so the code is the biggest thing on
 * it and everything else is what the person at the desk needs to confirm they
 * have the right client: the name, the client number, and what the client can
 * actually use right now.
 */

export interface ReadyItem {
  id: string;
  name: string;
  /** "Reward · paid with 500 points", "1 of 3 sessions". */
  detail: string | null;
  imageUrl: string | null;
}

export function ScanView({
  firstName,
  lastName,
  clientNumber,
  points,
  creditCents,
  currency,
  readyItems,
}: {
  firstName: string;
  lastName: string;
  /** Identifies, never authenticates — see lib/client-number.ts. */
  clientNumber: string;
  points: number;
  creditCents: number;
  currency: string;
  readyItems: ReadyItem[];
}) {
  const [token, setToken] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  // The code carries a signed, short-lived token; refreshing it every 60s
  // means a screenshot stops working.
  React.useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      mintScanTokenAction()
        .then((t) => {
          if (cancelled) return;
          setToken(t);
          setFailed(false);
        })
        // Keep the last code rather than blanking the card offline; only say
        // something when there is no code to show at all.
        .catch(() => !cancelled && setFailed(true));
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Hold the screen awake while the code is on display. The brightness is the
  // client's own — the app asks them to turn it up rather than doing it.
  React.useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request("screen")
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      void lock?.release().catch(() => {});
    };
  }, []);

  return (
    <div className="v2-scan">
      <h1>Scan</h1>
      <p className="lead">Show this code at the desk to earn points, pay with Credit or redeem your items.</p>

      <div className="card">
        <div className="qr">
          {token ? (
            <QrCode value={token} label="Your check-in code" />
          ) : failed ? (
            <span className="msg">Couldn&apos;t load your code. Check your connection, or sign in again.</span>
          ) : (
            <span className="msg">Loading…</span>
          )}
        </div>
        <b className="who">
          {firstName} {lastName}
        </b>
        <span className="num tabular">{clientNumber}</span>
        <div className="tiles">
          <div className="tile">
            <span>Points</span>
            <b className="tabular">{points}</b>
          </div>
          <div className="tile">
            <span>Credit</span>
            <b className="tabular">{money(creditCents, currency)}</b>
          </div>
        </div>
      </div>

      {readyItems.length > 0 && (
        <section className="ready">
          <h2>Ready to redeem · {readyItems.length}</h2>
          <div className="list">
            {readyItems.map((item) => (
              <div className="row" key={item.id}>
                <span className="thumb">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" />
                  ) : (
                    <Icon name="gift" size={20} />
                  )}
                </span>
                <span className="txt">
                  <b>{item.name}</b>
                  {item.detail && <span>{item.detail}</span>}
                </span>
                <Tag kind="success">READY</Tag>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="tip">Tip: turn up your screen brightness so the desk can scan it fast.</p>
    </div>
  );
}
