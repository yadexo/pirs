"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBasePath, useFinderPath } from "../base-path";
import { NotificationSettings } from "@/components/client-app/push";
import { MyItems, type ClientItem } from "./my-items";
import type { BalanceChange } from "@/lib/client-app-data";
import type { OwnedPackage } from "@/lib/client-app-packages";
import { Sheet, Icon, EmptyState, money, useToast } from "@/components/client-app/ui";
import { SegmentedControl } from "@/components/client-app/v2";
import { signOutOfClinicAction } from "@/lib/actions/session";
import {
  clientSaveProfileAction,
  clientSaveConsentAction,
  clientDeleteAccountAction,
  clientCancelPlanAction,
  clientCancelAppointmentAction,
} from "@/lib/actions/client-app";
import type { ClientSummary } from "@/lib/client-app-data";
import { BookingSheet } from "../shop/booking-sheet";
import type { BookableService } from "../shop/booking-sheet";
import { formatDay, formatTime } from "@/lib/client-format";
import { useClinicTimeZone } from "../base-path";

export interface ApptRow {
  id: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  location: string;
  startAt: string;
  status: string;
  upcoming: boolean;
}
export interface OrderRow {
  id: string;
  number: string;
  placedAt: string;
  totalCents: number;
  pointsEarned: number;
  itemNames: string[];
  /** What has been given back, and when the last of it was. */
  refundedCents?: number;
  refundedAt?: string | null;
}
export interface BillingRow {
  id: string;
  description: string;
  amountCents: number | null;
  occurredAt: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Three tabs, as the handoff draws them. Appointments and orders used to be a
 * fourth; they are now sheets opened from the bottom of My items, which is
 * where the board puts "Orders and receipts" — nothing was dropped, it just
 * stopped competing for a tab with the things a client came here to use.
 */
const SEGMENTS = [
  { value: "items", label: "My items" },
  { value: "membership", label: "Membership" },
  { value: "settings", label: "Account" },
] as const;

type SettingsSheet =
  | null
  | "personal"
  | "notifications"
  | "payment"
  | "orders"
  | "referral"
  | "language"
  | "help"
  | "legal"
  | "balances"
  | "appointments"
  | "delete";

/** One row in the Account list: icon tile, label, optional value, chevron. */
function AccountRow({ icon, label, value, onClick }: { icon: string; label: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" className="row" onClick={onClick}>
      <span className="ic" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="txt">{label}</span>
      {value && <span className="val">{value}</span>}
      <Icon name="chevR" size={20} />
    </button>
  );
}

export function ProfileView({
  merchantSlug,
  merchantName,
  currency,
  supportUrl,
  tab,
  summary,
  items,
  appointments,
  orders,
  billing,
  balanceHistory,
  packages,
  appVersion,
  platformName,
}: {
  merchantSlug: string;
  merchantName: string;
  currency: string;
  supportUrl: string | null;
  tab: string;
  summary: ClientSummary;
  /** Paid-for things still to collect, and the ones already used. */
  items: ClientItem[];
  appointments: ApptRow[];
  orders: OrderRow[];
  billing: BillingRow[];
  /** Credit and points the clinic moved, with the reason they gave. */
  balanceHistory: BalanceChange[];
  /** Session packages this client owns, used and expired ones included. */
  packages: OwnedPackage[];
  appVersion: string;
  /** The agency's own white-label name — never a hardcoded one. */
  platformName: string;
}) {
  const router = useRouter();
  const timeZone = useClinicTimeZone();
  const { toast } = useToast();
  const base = useBasePath();
  const finder = useFinderPath();

  const [sheet, setSheet] = React.useState<SettingsSheet>(null);
  const [pending, setPending] = React.useState(false);
  const [reschedule, setReschedule] = React.useState<{ appt: ApptRow } | null>(null);
  const [receipt, setReceipt] = React.useState<OrderRow | null>(null);
  const [confirmCancelPlan, setConfirmCancelPlan] = React.useState(false);
  const [deleteText, setDeleteText] = React.useState("");

  // Both pinned to one locale and the clinic's zone — see lib/client-format.ts.
  const date = (iso: string) => formatDay(iso, timeZone);
  const time = (iso: string) => formatTime(iso, timeZone);

  function go(next: string) {
    router.push(`${base}/profile${next === "items" ? "" : `?tab=${next}`}`);
  }

  async function cancelAppt(id: string) {
    setPending(true);
    const res = await clientCancelAppointmentAction(merchantSlug, id);
    setPending(false);
    if ("error" in res) toast(res.error);
    else {
      toast("Appointment cancelled");
      router.refresh();
    }
  }

  async function cancelPlan() {
    setPending(true);
    const res = await clientCancelPlanAction(merchantSlug);
    setPending(false);
    setConfirmCancelPlan(false);
    if ("error" in res) toast(res.error);
    else {
      toast("Membership cancelled");
      router.refresh();
    }
  }

  const hasTreatments = appointments.length > 0 || orders.length > 0;

  const initials = `${summary.firstName.charAt(0)}${summary.lastName.charAt(0)}`.toUpperCase();

  return (
    <div className="v2-profile">
      <header className="who">
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="info">
          <h1>
            {summary.firstName} {summary.lastName}
          </h1>
          <div className="meta">
            <span className="v2-tag v2-tag-soft">{summary.isMember ? (summary.membershipPlanName ?? "MEMBER") : "NOT A MEMBER"}</span>
            <span className="points tabular">
              <Icon name="star" size={14} /> {summary.loyaltyPoints} points
            </span>
          </div>
        </div>
      </header>

      <div className="tabs">
        <SegmentedControl label="Profile sections" value={tab} onChange={(next: string) => go(next)} options={SEGMENTS.map((s) => ({ value: s.value as string, label: s.label }))} />
      </div>

      {/* Appointments and orders, opened from the bottom of My items. */}
      <Sheet open={sheet === "appointments"} onClose={() => setSheet(null)} title="Appointments">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!hasTreatments ? (
            <div className="ca-card">
              <EmptyState
                text="No treatment purchased"
                sub="Browse the shop to book your first visit."
                cta={
                  <button className="btn-black" onClick={() => router.push(`${base}/shop`)}>
                    Browse the shop
                  </button>
                }
              />
            </div>
          ) : (
            <>
              {appointments.map((a) => (
                <div key={a.id} className="ordcard">
                  <span style={{ width: 58, height: 58, borderRadius: 14, background: "var(--pill-bg)", flex: "none", display: "grid", placeItems: "center", color: "var(--muted)" }}>
                    <Icon name="calendar" size={24} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-strong)", display: "block" }}>{a.serviceName}</b>
                    <span style={{ fontSize: 14, color: "var(--muted)" }}>
                      {date(a.startAt)} · {time(a.startAt)} · {a.location}
                    </span>
                  </div>
                  <span style={{ marginLeft: "auto", flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className={`status-pill ${a.upcoming ? "dark" : ""}`}>{a.status}</span>
                    {a.upcoming && (
                      <span style={{ display: "flex", gap: 10 }}>
                        <button
                          onClick={() => setReschedule({ appt: a })}
                          style={{ color: "var(--muted)", fontSize: 14, fontWeight: 500 }}
                        >
                          Reschedule
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => cancelAppt(a.id)}
                          style={{ color: "var(--danger)", fontSize: 14, fontWeight: 500 }}
                        >
                          Cancel
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              ))}

              {orders.map((o) => (
                <div key={o.id} className="ordcard">
                  <span style={{ width: 58, height: 58, borderRadius: 14, background: "var(--pill-bg)", flex: "none", display: "grid", placeItems: "center", color: "var(--muted)" }}>
                    <Icon name="bag" size={24} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-strong)", display: "block" }}>
                      {o.itemNames[0] ?? o.number}
                      {o.itemNames.length > 1 && ` +${o.itemNames.length - 1}`}
                    </b>
                    <span className="tabular" style={{ fontSize: 14, color: "var(--muted)" }}>
                      {date(o.placedAt)} · {money(o.totalCents, currency)}
                    </span>
                  </div>
                  <span style={{ marginLeft: "auto", flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="status-pill">Paid</span>
                    <button onClick={() => setReceipt(o)} style={{ color: "var(--muted)", fontSize: 14, fontWeight: 500 }}>
                      View receipt
                    </button>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </Sheet>

      {/* ------------------------------------------------------ membership */}
      {tab === "membership" && (
        <div style={{ padding: "var(--gap) var(--pad-x) 0", display: "flex", flexDirection: "column", gap: 14 }}>
          {summary.isMember ? (
            <>
              <div className="ca-card plancard">
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <h3 style={{ fontSize: 20, fontWeight: 700 }}>{summary.membershipPlanName}</h3>
                  <span style={{ flex: 1 }} />
                  {summary.membershipPriceCents != null && (
                    <>
                      <span className="tabular" style={{ fontSize: 24, fontWeight: 700 }}>
                        {money(summary.membershipPriceCents, currency)}
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: 15 }}>/month</span>
                    </>
                  )}
                </span>
                {summary.membershipNextBillingAt && (
                  <p style={{ color: "var(--muted)", fontSize: 14 }}>Next billing {date(summary.membershipNextBillingAt)}</p>
                )}
                <button
                  className="btn-black"
                  style={{ background: "transparent", color: "var(--danger)", boxShadow: "none", border: "1.5px solid var(--hairline)" }}
                  onClick={() => setConfirmCancelPlan(true)}
                >
                  Cancel membership
                </button>
              </div>

              <h2 className="h-sec" style={{ fontSize: 20, padding: "8px 0 0" }}>
                Billing history
              </h2>
              {billing.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 14 }}>No bills yet.</p>
              ) : (
                billing.map((b) => (
                  <div key={b.id} className="optrow">
                    <span>{b.description}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: "var(--muted)", fontSize: 14 }}>{date(b.occurredAt)}</span>
                    {b.amountCents != null && <b className="tabular">{money(b.amountCents, currency)}</b>}
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="ca-card">
              <EmptyState
                text="No subscription here"
                sub="Join a plan to unlock free treatments and perks."
                cta={
                  <button className="btn-black" onClick={() => router.push(`${base}/shop?tab=memberships`)}>
                    Browse memberships
                  </button>
                }
              />
            </div>
          )}
        </div>
      )}

      {tab === "items" && (
        <>
          <MyItems items={items} packages={packages} merchantSlug={merchantSlug} />
          <div className="v2-profilelinks">
            <button type="button" className="row" onClick={() => setSheet("appointments")}>
              <span className="ic" aria-hidden="true">
                <Icon name="calendar" size={20} />
              </span>
              <span className="txt">Appointments</span>
              <Icon name="chevR" size={20} />
            </button>
            <button type="button" className="row" onClick={() => setSheet("orders")}>
              <span className="ic" aria-hidden="true">
                <Icon name="bag" size={20} />
              </span>
              <span className="txt">Orders and receipts</span>
              <Icon name="chevR" size={20} />
            </button>
          </div>
        </>
      )}

      {/* -------------------------------------------------------- settings */}
      {/* Account: grouped as the board groups it — the client's own details,
          then the app, then the clinic, then the two destructive ones. */}
      {tab === "settings" && (
        <div className="v2-account">
          <h2>Your details</h2>
          <div className="group">
            <AccountRow icon="user" label="Personal details" onClick={() => setSheet("personal")} />
            <AccountRow icon="card" label="Saved payment methods" onClick={() => setSheet("payment")} />
            <AccountRow icon="tag" label="Credit and points history" onClick={() => setSheet("balances")} />
            <AccountRow icon="globe" label="Language" value="English" onClick={() => setSheet("language")} />
          </div>

          <h2>App</h2>
          <div className="group">
            <AccountRow icon="bell" label="Notifications" onClick={() => setSheet("notifications")} />
            <AccountRow icon="users" label="Referral link" onClick={() => setSheet("referral")} />
            <Link className="row" href={`${finder}?switch=1`} prefetch={false}>
              <span className="ic" aria-hidden="true">
                <Icon name="pin" size={20} />
              </span>
              <span className="txt">Switch clinic</span>
              <Icon name="chevR" size={20} />
            </Link>
          </div>

          <h2>Clinic</h2>
          <div className="group">
            <AccountRow icon="help" label="Contact the clinic" onClick={() => setSheet("help")} />
            <AccountRow icon="shield" label="Terms and privacy" onClick={() => setSheet("legal")} />
          </div>

          <form action={signOutOfClinicAction.bind(null, merchantSlug)}>
            <button type="submit" className="v2-logout">
              <Icon name="exit" size={20} /> Log out
            </button>
          </form>
          <button type="button" className="v2-delete" onClick={() => setSheet("delete")}>
            Delete account
          </button>

          {/* A platform that has not named itself says nothing, rather than
              leaving a gap where a name should be. */}
          <p className="v2-poweredby">
            {platformName ? `Powered by ${platformName} · ` : ""}Version {appVersion}
          </p>
        </div>
      )}

      {/* ---------------------------------------------------------- sheets */}

      <PersonalSheet
        open={sheet === "personal"}
        onClose={() => setSheet(null)}
        merchantSlug={merchantSlug}
        summary={summary}
        onSaved={() => {
          setSheet(null);
          toast("Saved");
          router.refresh();
        }}
      />

      <NotificationsSheet
        open={sheet === "notifications"}
        onClose={() => setSheet(null)}
        merchantSlug={merchantSlug}
        summary={summary}
        onSaved={() => {
          setSheet(null);
          toast("Preferences saved");
          router.refresh();
        }}
      />

      <Sheet open={sheet === "payment"} onClose={() => setSheet(null)} title="Payment methods">
        <p style={{ color: "var(--muted)", fontSize: 15 }}>
          Payment details are held by the clinic&apos;s payment provider and never stored in this app. Add or change a card at
          checkout.
        </p>
        <button className="optrow" onClick={() => setSheet(null)}>
          <Icon name="card" size={20} /> Manage at checkout
        </button>
      </Sheet>

      {/* Where a client finds out why their balance changed. The clinic's
          own words are shown as they were written, because a push
          notification scrolls away and this does not. */}
      <Sheet open={sheet === "balances"} onClose={() => setSheet(null)} title="Credit & points history">
        {balanceHistory.length === 0 ? (
          <EmptyState text="Nothing yet" sub="Changes your clinic makes to your credit or points show up here." />
        ) : (
          balanceHistory.map((row) => (
            <div key={row.id} className="optrow">
              <span style={{ flex: 1 }}>
                <b style={{ fontSize: 15 }}>
                  {row.headline} by {merchantName}
                </b>
                {row.reason && (
                  <>
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: 14 }}>{row.reason}</span>
                  </>
                )}
                <br />
                <span style={{ color: "var(--muted)", fontSize: 14 }}>{date(row.at)}</span>
              </span>
              <b className="tabular" style={{ color: row.amount < 0 ? "var(--danger)" : undefined }}>
                {row.amount < 0 ? "−" : "+"}
                {row.kind === "credit" ? money(Math.abs(row.amount), currency) : `${Math.abs(row.amount)} pts`}
              </b>
            </div>
          ))
        )}
      </Sheet>

      <Sheet open={sheet === "orders"} onClose={() => setSheet(null)} title="Order history">
        {orders.length === 0 ? (
          <EmptyState text="No orders yet" />
        ) : (
          orders.map((o) => (
            <button key={o.id} className="optrow" onClick={() => setReceipt(o)}>
              <span style={{ flex: 1 }}>
                <b style={{ fontSize: 15 }}>{o.number}</b>
                <br />
                <span style={{ color: "var(--muted)", fontSize: 14 }}>{date(o.placedAt)}</span>
                {!!o.refundedCents && o.refundedCents > 0 && (
                  <>
                    <br />
                    <span style={{ color: "var(--danger)", fontSize: 14 }}>
                      Refunded {money(o.refundedCents, currency)}
                      {o.refundedAt ? ` on ${date(o.refundedAt)}` : ""}
                    </span>
                  </>
                )}
              </span>
              <b className="tabular">{money(o.totalCents, currency)}</b>
            </button>
          ))
        )}
      </Sheet>

      <Sheet
        open={sheet === "referral"}
        onClose={() => setSheet(null)}
        title="Referral link"
        cta={
          <button
            className="btn-black"
            onClick={async () => {
              const url = `${window.location.origin}${base}`;
              if (navigator.share) await navigator.share({ title: merchantName, url }).catch(() => {});
              else {
                await navigator.clipboard.writeText(url).catch(() => {});
                toast("Link copied");
              }
            }}
          >
            <Icon name="share" size={20} /> Share link
          </button>
        }
      >
        <p style={{ color: "var(--muted)", fontSize: 15 }}>
          Invite a friend to {merchantName}. You both benefit when they join.
        </p>
      </Sheet>

      <Sheet open={sheet === "language"} onClose={() => setSheet(null)} title="Language">
        <button className="optrow on">
          <span className="rad" /> English
        </button>
        <p style={{ color: "var(--muted)", fontSize: 14, paddingTop: 10 }}>
          More languages will appear here once the clinic enables them.
        </p>
      </Sheet>

      <Sheet open={sheet === "help"} onClose={() => setSheet(null)} title="Help & support">
        {supportUrl ? (
          <a className="optrow" href={supportUrl} target="_blank" rel="noreferrer">
            <Icon name="help" size={20} /> Contact support
            <span style={{ flex: 1 }} />
            <Icon name="chevR" size={18} />
          </a>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 15 }}>
            Call the clinic directly from the Home screen, or reply to any message from {merchantName}.
          </p>
        )}
      </Sheet>

      <Sheet open={sheet === "legal"} onClose={() => setSheet(null)} title="Terms & privacy">
        <p style={{ color: "var(--muted)", fontSize: 15 }}>
          Your data is held by {merchantName} and used to manage your care, purchases and rewards. Marketing messages are only
          sent with your consent, which you can withdraw at any time under Notification preferences.
        </p>
      </Sheet>

      <Sheet
        open={sheet === "delete"}
        onClose={() => {
          setSheet(null);
          setDeleteText("");
        }}
        title="Delete account"
        cta={
          <button
            className="btn-black"
            style={{ background: "var(--danger)" }}
            disabled={deleteText.trim() !== "DELETE" || pending}
            onClick={async () => {
              setPending(true);
              await clientDeleteAccountAction(merchantSlug);
              setPending(false);
              await signOutOfClinicAction(merchantSlug);
            }}
          >
            Delete my account
          </button>
        }
      >
        <p style={{ color: "var(--muted)", fontSize: 15 }}>
          This closes your account with {merchantName} and stops all messages. Your treatment and payment history is kept by the
          clinic where it is legally required to. Type <b style={{ color: "var(--ink)" }}>DELETE</b> to confirm.
        </p>
        <div className="frm" style={{ marginTop: 14 }}>
          <input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
            style={{ letterSpacing: "0.08em" }}
          />
        </div>
      </Sheet>

      <Sheet
        open={confirmCancelPlan}
        onClose={() => setConfirmCancelPlan(false)}
        title="Cancel membership?"
        cta={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmCancelPlan(false)}>
              Keep it
            </button>
            <button className="btn-black" style={{ flex: 2, background: "var(--danger)" }} disabled={pending} onClick={cancelPlan}>
              Cancel membership
            </button>
          </div>
        }
      >
        <p style={{ color: "var(--muted)", fontSize: 15 }}>
          You&apos;ll keep your benefits until the end of the current billing period.
        </p>
      </Sheet>

      <Sheet open={!!receipt} onClose={() => setReceipt(null)} title={receipt ? `Receipt ${receipt.number}` : undefined}>
        {receipt && (
          <>
            {receipt.itemNames.map((n, i) => (
              <div key={i} className="optrow">
                <span>{n}</span>
              </div>
            ))}
            <div className="optrow">
              <span>Date</span>
              <span style={{ flex: 1 }} />
              <span>{date(receipt.placedAt)}</span>
            </div>
            <div className="optrow">
              <span>Total</span>
              <span style={{ flex: 1 }} />
              <b className="tabular">{money(receipt.totalCents, currency)}</b>
            </div>
            <div className="optrow" style={{ border: 0 }}>
              <span>Points earned</span>
              <span style={{ flex: 1 }} />
              <b className="tabular">+{receipt.pointsEarned}</b>
            </div>
          </>
        )}
      </Sheet>

      <BookingSheet
        merchantSlug={merchantSlug}
        currency={currency}
        appointmentId={reschedule?.appt.id}
        service={
          reschedule
            ? ({
                id: reschedule.appt.serviceId,
                name: reschedule.appt.serviceName,
                priceCents: 0,
                durationMinutes: reschedule.appt.durationMinutes,
              } satisfies BookableService)
            : null
        }
        onClose={() => setReschedule(null)}
        onBooked={() => {
          setReschedule(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function PersonalSheet({
  open,
  onClose,
  merchantSlug,
  summary,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  merchantSlug: string;
  summary: ClientSummary;
  onSaved: () => void;
}) {
  const [first, setFirst] = React.useState(summary.firstName);
  const [last, setLast] = React.useState(summary.lastName);
  const [phone, setPhone] = React.useState(summary.phone ?? "");
  const [bDay, setBDay] = React.useState(summary.birthdayDay ? String(summary.birthdayDay) : "");
  const [bMonth, setBMonth] = React.useState(summary.birthdayMonth ? String(summary.birthdayMonth) : "");
  const [bYear, setBYear] = React.useState(summary.birthdayYear ? String(summary.birthdayYear) : "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFirst(summary.firstName);
      setLast(summary.lastName);
      setPhone(summary.phone ?? "");
      setBDay(summary.birthdayDay ? String(summary.birthdayDay) : "");
      setBMonth(summary.birthdayMonth ? String(summary.birthdayMonth) : "");
      setBYear(summary.birthdayYear ? String(summary.birthdayYear) : "");
      setError(null);
    }
  }, [open, summary]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Personal details"
      cta={
        <button
          className="btn-black"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const res = await clientSaveProfileAction(merchantSlug, {
              firstName: first,
              lastName: last,
              phone,
              birthdayDay: bDay ? Number(bDay) : undefined,
              birthdayMonth: bMonth ? Number(bMonth) : undefined,
              birthdayYear: bYear ? Number(bYear) : undefined,
            });
            setPending(false);
            if ("error" in res) setError(res.error);
            else onSaved();
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="frm">
        <label htmlFor="pf-first">First name</label>
        <input id="pf-first" value={first} onChange={(e) => setFirst(e.target.value)} />
      </div>
      <div className="frm">
        <label htmlFor="pf-last">Last name</label>
        <input id="pf-last" value={last} onChange={(e) => setLast(e.target.value)} />
      </div>
      <div className="frm">
        <label htmlFor="pf-phone">Phone</label>
        <input id="pf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="frm">
        <label htmlFor="pf-bday">Birthday</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="pf-bday"
            inputMode="numeric"
            placeholder="Day"
            maxLength={2}
            value={bDay}
            onChange={(e) => setBDay(e.target.value.replace(/\D/g, ""))}
            style={{ flex: 1 }}
          />
          <select value={bMonth} onChange={(e) => setBMonth(e.target.value)} style={{ flex: 2 }} aria-label="Birthday month">
            <option value="">Month</option>
            {MONTHS.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <input
            inputMode="numeric"
            placeholder="Year"
            maxLength={4}
            value={bYear}
            onChange={(e) => setBYear(e.target.value.replace(/\D/g, ""))}
            aria-label="Birthday year, optional"
            style={{ flex: 1.2 }}
          />
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "6px 0 0" }}>
          The year is optional — the clinic only needs the day to wish you a happy birthday.
        </p>
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 14 }}>{error}</p>}
    </Sheet>
  );
}

function NotificationsSheet({
  open,
  onClose,
  merchantSlug,
  summary,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  merchantSlug: string;
  summary: ClientSummary;
  onSaved: () => void;
}) {
  const [state, setState] = React.useState({
    emailConsent: summary.emailConsent,
    smsConsent: summary.smsConsent,
    pushConsent: summary.pushConsent,
    marketingConsent: summary.marketingConsent,
  });
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open)
      setState({
        emailConsent: summary.emailConsent,
        smsConsent: summary.smsConsent,
        pushConsent: summary.pushConsent,
        marketingConsent: summary.marketingConsent,
      });
  }, [open, summary]);

  const rows: [keyof typeof state, string][] = [
    ["emailConsent", "Email"],
    ["smsConsent", "SMS"],
    ["pushConsent", "Push notifications"],
    ["marketingConsent", "Offers and promotions"],
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Notification preferences"
      cta={
        <button
          className="btn-black"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await clientSaveConsentAction(merchantSlug, state);
            setPending(false);
            onSaved();
          }}
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>
      }
    >
      <NotificationSettings />
      {rows.map(([key, label]) => (
        <button key={key} className={`optrow ${state[key] ? "on" : ""}`} onClick={() => setState((s) => ({ ...s, [key]: !s[key] }))}>
          <span className="rad" />
          {label}
        </button>
      ))}
      <p style={{ color: "var(--muted)", fontSize: 14, paddingTop: 12 }}>
        Appointment reminders are always sent — turning these off only stops marketing.
      </p>
    </Sheet>
  );
}
