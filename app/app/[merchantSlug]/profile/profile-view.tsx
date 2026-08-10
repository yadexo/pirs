"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sheet, Icon, EmptyState, money, useToast } from "@/components/client-app/ui";
import { signOutAction } from "@/lib/actions/session";
import {
  clientSaveProfileAction,
  clientSaveConsentAction,
  clientDeleteAccountAction,
  clientCancelPlanAction,
  clientCancelAppointmentAction,
} from "@/lib/actions/client-app";
import type { ClientSummary } from "@/lib/client-app-data";
import { BookingSheet } from "../shop/booking-sheet";
import type { ShopService } from "../shop/shop-view";

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
}
export interface BillingRow {
  id: string;
  description: string;
  amountCents: number | null;
  occurredAt: string;
}

const SEGMENTS = [
  { key: "treatments", label: "Treatments" },
  { key: "membership", label: "Membership" },
  { key: "settings", label: "Settings" },
];

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
  | "delete";

export function ProfileView({
  merchantSlug,
  merchantName,
  currency,
  supportUrl,
  tab,
  summary,
  appointments,
  orders,
  billing,
  appVersion,
}: {
  merchantSlug: string;
  merchantName: string;
  currency: string;
  supportUrl: string | null;
  tab: string;
  summary: ClientSummary;
  appointments: ApptRow[];
  orders: OrderRow[];
  billing: BillingRow[];
  appVersion: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const base = `/app/${merchantSlug}`;
  const segRef = React.useRef<HTMLDivElement>(null);

  const [sheet, setSheet] = React.useState<SettingsSheet>(null);
  const [pending, setPending] = React.useState(false);
  const [reschedule, setReschedule] = React.useState<{ appt: ApptRow } | null>(null);
  const [receipt, setReceipt] = React.useState<OrderRow | null>(null);
  const [confirmCancelPlan, setConfirmCancelPlan] = React.useState(false);
  const [deleteText, setDeleteText] = React.useState("");

  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });
  React.useLayoutEffect(() => {
    const active = segRef.current?.querySelector<HTMLButtonElement>("button.on");
    if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
  }, [tab]);

  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  function go(next: string) {
    router.push(`${base}/profile${next === "treatments" ? "" : `?tab=${next}`}`);
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

  return (
    <div>
      <div className="seg" ref={segRef}>
        {SEGMENTS.map((s) => (
          <button key={s.key} className={tab === s.key ? "on" : undefined} onClick={() => go(s.key)}>
            {s.label}
          </button>
        ))}
        <i className="ind" style={{ left: indicator.left, width: indicator.width }} />
      </div>

      {/* ------------------------------------------------------ treatments */}
      {tab === "treatments" && (
        <div style={{ padding: "var(--gap) var(--pad-x) 0", display: "flex", flexDirection: "column", gap: 14 }}>
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
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {date(a.startAt)} · {time(a.startAt)} · {a.location}
                    </span>
                  </div>
                  <span style={{ marginLeft: "auto", flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className={`status-pill ${a.upcoming ? "dark" : ""}`}>{a.status}</span>
                    {a.upcoming && (
                      <span style={{ display: "flex", gap: 10 }}>
                        <button
                          onClick={() => setReschedule({ appt: a })}
                          style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500 }}
                        >
                          Reschedule
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => cancelAppt(a.id)}
                          style={{ color: "var(--danger)", fontSize: 13, fontWeight: 500 }}
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
                    <span className="tabular" style={{ fontSize: 13, color: "var(--muted)" }}>
                      {date(o.placedAt)} · {money(o.totalCents, currency)}
                    </span>
                  </div>
                  <span style={{ marginLeft: "auto", flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="status-pill">Paid</span>
                    <button onClick={() => setReceipt(o)} style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500 }}>
                      View receipt
                    </button>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

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
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>{date(b.occurredAt)}</span>
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

      {/* -------------------------------------------------------- settings */}
      {tab === "settings" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "var(--gap) var(--pad-x)" }}>
            <SettingRow label="Personal details" onClick={() => setSheet("personal")} />
            <SettingRow label="Notification preferences" onClick={() => setSheet("notifications")} />
            <SettingRow label="Payment methods" onClick={() => setSheet("payment")} />
            <SettingRow label="Order history" onClick={() => setSheet("orders")} />
            <SettingRow label="Referral link" onClick={() => setSheet("referral")} />
            <SettingRow label="Language" onClick={() => setSheet("language")} />
            <SettingRow label="Help & support" onClick={() => setSheet("help")} />
            <SettingRow label="Terms & privacy" onClick={() => setSheet("legal")} />
            <SettingRow label="Delete account" danger onClick={() => setSheet("delete")} />
            <form action={signOutAction}>
              <button type="submit" className="setrow" style={{ justifyContent: "space-between" }}>
                <span>Log out</span>
                <Icon name="exit" size={20} />
              </button>
            </form>
          </div>
          <p style={{ textAlign: "center", color: "var(--faint)", fontSize: 14, padding: "24px 0 6px" }}>Version {appVersion}</p>
        </>
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

      <Sheet open={sheet === "orders"} onClose={() => setSheet(null)} title="Order history">
        {orders.length === 0 ? (
          <EmptyState text="No orders yet" />
        ) : (
          orders.map((o) => (
            <button key={o.id} className="optrow" onClick={() => setReceipt(o)}>
              <span style={{ flex: 1 }}>
                <b style={{ fontSize: 15 }}>{o.number}</b>
                <br />
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{date(o.placedAt)}</span>
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
              await signOutAction();
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
        appointmentId={reschedule?.appt.id}
        service={
          reschedule
            ? ({
                id: reschedule.appt.serviceId,
                name: reschedule.appt.serviceName,
                description: null,
                priceCents: 0,
                durationMinutes: reschedule.appt.durationMinutes,
                images: [],
                bookable: true,
                categoryName: "",
              } satisfies ShopService)
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

function SettingRow({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`setrow ${danger ? "danger" : ""}`} onClick={onClick}>
      <span>{label}</span>
      {danger ? <Icon name="trash" size={20} /> : <Icon name="chevR" size={20} />}
    </button>
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
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFirst(summary.firstName);
      setLast(summary.lastName);
      setPhone(summary.phone ?? "");
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
            const res = await clientSaveProfileAction(merchantSlug, { firstName: first, lastName: last, phone });
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
