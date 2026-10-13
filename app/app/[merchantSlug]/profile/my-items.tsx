"use client";

import * as React from "react";
import { Icon, QrCode, Sheet } from "@/components/client-app/ui";
import { redeemQrValue } from "@/lib/redeemable-shared";
import { formatDay } from "@/lib/client-format";
import { useClinicTimeZone } from "../base-path";
import { useRouter } from "next/navigation";
import { useToast, Stepper } from "@/components/client-app/ui";
import { Button, TextField } from "@/components/client-app/v2";
import { clientGiveSessionsAction } from "@/lib/actions/client-app";
import type { OwnedPackage } from "@/lib/client-app-packages";

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
  /** The clinic's booking page for this treatment, when it has one. */
  bookingUrl: string | null;
}

const STATUS_LABEL: Record<ClientItem["status"], string> = {
  AVAILABLE: "Ready to collect",
  REDEEMED: "Redeemed",
  VOIDED: "Refunded",
  EXPIRED: "Expired",
};

const day = (iso: string, timeZone: string) => formatDay(iso, timeZone);

export function MyItems({ items, packages, merchantSlug }: { items: ClientItem[]; packages: OwnedPackage[]; merchantSlug: string }) {
  const timeZone = useClinicTimeZone();
  const [giving, setGiving] = React.useState<OwnedPackage | null>(null);
  const usable = packages.filter((p) => !p.expired && p.remainingUses > 0);
  const spent = packages.filter((p) => p.expired || p.remainingUses === 0);
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

  if (items.length === 0 && packages.length === 0) {
    return (
      <div className="v2-items">
        <p className="none">Anything you buy in the app appears here with its own code to show at the clinic.</p>
      </div>
    );
  }

  return (
    <div className="v2-items">
      {(available.length > 0 || usable.length > 0) && (
        <section>
          <h2>Ready to use</h2>

          {/* Packages first: they are several sessions and the most to say. */}
          {usable.map((pkg) => (
            <div className="v2-pkgowned" key={pkg.id}>
              <div className="top">
                <span className="thumb" aria-hidden="true">
                  {pkg.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pkg.imageUrl} alt="" />
                  ) : (
                    <Icon name="sparkle" size={20} />
                  )}
                </span>
                <span className="txt">
                  <b>
                    {pkg.name} <span className="v2-tag v2-tag-photo">Package</span>
                  </b>
                  <span>
                    {pkg.sessionsLabel}
                    {pkg.expiresAt ? `, valid until ${formatDay(pkg.expiresAt, timeZone)}` : ""}
                  </span>
                  {pkg.receivedFromName && <span className="from">Given to you by {pkg.receivedFromName}</span>}
                </span>
              </div>

              {/* One segment per session, so what is left is countable. */}
              <div className="pips" aria-hidden="true">
                {Array.from({ length: pkg.totalUses }, (_, i) => (
                  <span key={i} className={i < pkg.remainingUses ? "on" : undefined} />
                ))}
              </div>

              {pkg.covers.length > 0 && (
                <div className="covers">
                  {pkg.covers.map((c) => (
                    <div className="row" key={c.id}>
                      <span>{c.name}</span>
                      {c.bookingUrl ? (
                        <a className="book" href={c.bookingUrl} target="_blank" rel="noreferrer">
                          Book
                          <Icon name="share" size={14} />
                        </a>
                      ) : (
                        <span className="desk">Book at the desk</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {pkg.canGive && (
                <button type="button" className="give" onClick={() => setGiving(pkg)}>
                  <Icon name="share" size={18} />
                  Give sessions to someone
                  <Icon name="chevR" size={18} />
                </button>
              )}
            </div>
          ))}

          <div className="list">
            {available.map((item) => (
              <div key={item.id} className="rowwrap">
                <button type="button" className="row" onClick={() => setOpen(item)}>
                  <span className="thumb" aria-hidden="true">
                    <Icon name="qr" size={20} />
                  </span>
                  <span className="txt">
                    <b>{item.name}</b>
                    <span>{item.bookingUrl ? "Ready to book" : "Show your code at the desk"}</span>
                  </span>
                  <Icon name="chevR" size={20} />
                </button>
                {/* Only when the clinic has given this treatment a page to
                    book on; otherwise the row above is the whole story. */}
                {item.bookingUrl && (
                  <a className="book" href={item.bookingUrl} target="_blank" rel="noreferrer">
                    Book appointment
                    <Icon name="share" size={16} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(past.length > 0 || spent.length > 0) && (
        <section>
          <h2>Past items</h2>
          <div className="list past">
            {spent.map((pkg) => (
              <div className="row" key={pkg.id}>
                <span className="thumb" aria-hidden="true">
                  <Icon name="sparkle" size={20} />
                </span>
                <span className="txt">
                  <b>{pkg.name}</b>
                  <span>
                    {pkg.expired ? "Expired" : "All sessions used"}
                    {pkg.expiresAt ? ` · ${formatDay(pkg.expiresAt, timeZone)}` : ""}
                  </span>
                </span>
              </div>
            ))}
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

      <GiveSessionsSheet pkg={giving} merchantSlug={merchantSlug} timeZone={timeZone} onClose={() => setGiving(null)} />

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

/**
 * Giving sessions away.
 *
 * It happens at once and cannot be undone, so the sheet says so before the
 * button rather than after it, and shows what the giver will have left.
 */
function GiveSessionsSheet({
  pkg,
  merchantSlug,
  timeZone,
  onClose,
}: {
  pkg: OwnedPackage | null;
  merchantSlug: string;
  timeZone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [count, setCount] = React.useState(1);
  const [contact, setContact] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (pkg) {
      setCount(1);
      setContact("");
      setError(null);
    }
  }, [pkg]);

  if (!pkg) return null;

  async function give() {
    if (!pkg) return;
    setPending(true);
    setError(null);
    const res = await clientGiveSessionsAction(merchantSlug, pkg.id, count, contact);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast(`${res.sessions} session${res.sessions === 1 ? "" : "s"} given`);
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Give sessions"
      cta={
        <Button loading={pending} disabled={!contact.trim()} onClick={() => void give()}>
          Give {count} session{count === 1 ? "" : "s"}
        </Button>
      }
    >
      <div className="v2-give">
        <div className="summary">
          <b>{pkg.name}</b>
          <span>
            {pkg.sessionsLabel}
            {pkg.expiresAt ? `, valid until ${formatDay(pkg.expiresAt, timeZone)}` : ""}
          </span>
        </div>

        <div className="howmany">
          <span>How many</span>
          <Stepper value={count} min={1} max={pkg.remainingUses} onChange={setCount} />
        </div>

        <TextField
          label="Their email or phone number"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="name@example.com"
          inputMode="email"
        />

        <ul className="facts">
          <li>They need an account at this clinic already.</li>
          <li>The sessions arrive in their My items with the same treatments and the same end date.</li>
          <li>This can&apos;t be undone.</li>
        </ul>

        <p className="left">
          You&apos;ll have {pkg.remainingUses - count} session{pkg.remainingUses - count === 1 ? "" : "s"} left.
        </p>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
