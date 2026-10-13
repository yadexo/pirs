"use client";

import * as React from "react";
import { Icon, QrCode, Sheet } from "@/components/client-app/ui";
import { redeemQrValue } from "@/lib/redeemable-shared";
import { formatDay } from "@/lib/client-format";
import { useClinicTimeZone } from "../base-path";

/**
 * "My items" — the things this client has paid for and can still collect.
 *
 * Each one carries its own code. The QR holds nothing but a random token, so a
 * screenshot shared by accident gives away no name, no order and no clinic.
 *
 * While an item's code is on screen the app asks the server every few seconds
 * whether it has been used, so the moment a receptionist scans it the client
 * sees it change rather than holding up a code that no longer works.
 */

export interface ClientItem {
  id: string;
  name: string;
  status: "AVAILABLE" | "REDEEMED" | "VOIDED" | "EXPIRED";
  code: string;
  token: string;
  purchasedAt: string;
  redeemedAt: string | null;
  expiresAt: string | null;
}

const STATUS_LABEL: Record<ClientItem["status"], string> = {
  AVAILABLE: "Ready to collect",
  REDEEMED: "Redeemed",
  VOIDED: "Refunded",
  EXPIRED: "Expired",
};

const day = (iso: string, timeZone: string) => formatDay(iso, timeZone);

export function MyItems({ items }: { items: ClientItem[] }) {
  const timeZone = useClinicTimeZone();
  const [open, setOpen] = React.useState<ClientItem | null>(null);
  const [live, setLive] = React.useState<Record<string, ClientItem["status"]>>({});

  const statusOf = React.useCallback((item: ClientItem) => live[item.id] ?? item.status, [live]);

  // Watch the open item only: one small request every three seconds, and none
  // at all when nothing is on screen.
  React.useEffect(() => {
    if (!open || statusOf(open) !== "AVAILABLE") return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/items/${encodeURIComponent(open.id)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: ClientItem["status"] };
        if (!stop && data.status) setLive((s) => ({ ...s, [open.id]: data.status! }));
      } catch {
        /* offline, or the app was backgrounded: try again on the next tick */
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [open, statusOf]);

  const available = items.filter((i) => statusOf(i) === "AVAILABLE");
  const past = items.filter((i) => statusOf(i) !== "AVAILABLE");
  const openStatus = open ? statusOf(open) : null;

  if (items.length === 0) {
    return (
      <div className="v2-items">
        <p className="none">Anything you buy in the app appears here with its own code to show at the clinic.</p>
      </div>
    );
  }

  return (
    <div className="v2-items">
      {available.length > 0 && (
        <section>
          <h2>Ready to use</h2>
          <div className="list">
            {available.map((item) => (
              <button key={item.id} type="button" className="row" onClick={() => setOpen(item)}>
                <span className="thumb" aria-hidden="true">
                  <Icon name="qr" size={20} />
                </span>
                <span className="txt">
                  <b>{item.name}</b>
                  {/* Booking links come in a later stage; until then every item
                      is collected the same way. */}
                  <span>Show your code at the desk</span>
                </span>
                <Icon name="chevR" size={20} />
              </button>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2>Past items</h2>
          <div className="list past">
            {past.map((item) => (
              <div key={item.id} className="row" >
                <span className="thumb" aria-hidden="true">
                  <Icon name="qr" size={20} />
                </span>
                <span className="txt">
                  <b>{item.name}</b>
                  <span>
                    {STATUS_LABEL[statusOf(item)]}
                    {item.redeemedAt ? ` · ${day(item.redeemedAt, timeZone)}` : ""}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} full title={open?.name}>
        {open && (
          <div style={{ textAlign: "center", paddingBottom: 24 }}>
            {openStatus === "AVAILABLE" ? (
              <>
                <p style={{ color: "var(--muted)", fontSize: 15, margin: "0 0 18px" }}>
                  Show this at the clinic. Turn your screen brightness up so the camera can read it.
                </p>
                <div className="ca-itemqrbox">
                  <QrCode value={redeemQrValue(open.token)} label={`Code for ${open.name}`} />
                </div>
                <p className="ca-itemcode tabular">{open.code}</p>
                <p style={{ color: "var(--muted)", fontSize: 14, margin: "6px 0 0" }}>
                  Staff can type this code if the camera won&apos;t read the screen.
                </p>
              </>
            ) : (
              <div style={{ padding: "40px 0" }}>
                <p style={{ fontSize: 44, margin: 0 }} aria-hidden="true">
                  {openStatus === "REDEEMED" ? "✓" : "—"}
                </p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-strong)", margin: "8px 0 4px" }}>
                  {openStatus ? STATUS_LABEL[openStatus] : ""}
                </p>
                <p style={{ color: "var(--muted)", fontSize: 15, margin: 0 }}>
                  {openStatus === "REDEEMED"
                    ? "Enjoy! This code has been used."
                    : openStatus === "VOIDED"
                      ? "This order was refunded, so the code no longer works."
                      : "This item is past its date."}
                </p>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
