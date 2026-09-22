"use client";

import * as React from "react";
import { Sheet, useToast } from "@/components/client-app/ui";
import { getBookingOptionsForServiceAction, getClientSlotsAction, clientBookAction, clientOrderStatusAction, clientAbandonOrderAction } from "@/lib/actions/client-app";
import { CardPayment, type PaymentHandoff } from "../card-payment";
import type { ShopService } from "./shop-view";

interface Options {
  durationMinutes: number;
  staff: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}

/**
 * Date → time → practitioner, then commit. Slots come from the same
 * availability engine the clinic calendar uses, so the client can only
 * pick times the clinic actually has free.
 */
export function BookingSheet({
  merchantSlug,
  currency,
  service,
  appointmentId,
  onClose,
  onBooked,
}: {
  merchantSlug: string;
  /** For showing a deposit amount in the clinic's own currency. */
  currency: string;
  service: ShopService | null;
  /** Set when rescheduling an existing appointment. */
  appointmentId?: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { toast } = useToast();
  const [options, setOptions] = React.useState<Options | null>(null);
  const [staffId, setStaffId] = React.useState("");
  const [locationId, setLocationId] = React.useState("");
  const [date, setDate] = React.useState(() => nextDays()[0]!.iso);
  const [slots, setSlots] = React.useState<string[]>([]);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The clinic asks for a deposit: the slot is held as requested until it is paid. */
  const [deposit, setDeposit] = React.useState<{ payment: PaymentHandoff; orderNumber: string; amountCents: number } | null>(null);
  const [settling, setSettling] = React.useState(false);

  React.useEffect(() => {
    if (!service) return;
    setError(null);
    setSlot(null);
    getBookingOptionsForServiceAction(service.id).then((o) => {
      if (!o) return;
      setOptions(o);
      setStaffId(o.staff[0]?.id ?? "");
      setLocationId(o.locations[0]?.id ?? "");
    });
  }, [service]);

  React.useEffect(() => {
    if (!service || !options || !staffId || !locationId) return;
    setLoading(true);
    setSlot(null);
    getClientSlotsAction(staffId, locationId, options.durationMinutes, new Date(date).toISOString())
      .then(setSlots)
      .catch(() => setSlots([]))
      .finally(() => setLoading(false));
  }, [service, options, staffId, locationId, date]);

  async function confirm() {
    if (!service || !slot) return;
    setPending(true);
    setError(null);
    const res = await clientBookAction(merchantSlug, {
      serviceId: service.id,
      staffProfileId: staffId,
      locationId,
      startAtIso: slot,
      appointmentId,
    });
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if ("deposit" in res && res.deposit) {
      setDeposit({ payment: res.deposit.payment, orderNumber: res.deposit.orderNumber, amountCents: res.deposit.amountCents });
      return;
    }
    toast(appointmentId ? "Appointment updated" : "Booking requested");
    onBooked();
  }

  /** The deposit is confirmed by the webhook, which also confirms the appointment. */
  async function afterDeposit() {
    if (!deposit) return;
    setSettling(true);
    let confirmed = false;
    for (let attempt = 0; attempt < 6 && !confirmed; attempt++) {
      const status = await clientOrderStatusAction(merchantSlug, deposit.orderNumber).catch(() => null);
      if (status && "ok" in status && status.status === "PAID") confirmed = true;
      else if (status && "ok" in status && status.status === "FAILED") {
        setSettling(false);
        setDeposit(null);
        setError("That payment didn't go through. Please pick a time again.");
        return;
      } else await new Promise((r) => setTimeout(r, 700));
    }
    setSettling(false);
    setDeposit(null);
    toast(confirmed ? "Booking confirmed" : "Deposit received. Your booking is being confirmed.");
    onBooked();
  }

  async function cancelDeposit() {
    if (deposit) await clientAbandonOrderAction(merchantSlug, deposit.orderNumber).catch(() => undefined);
    setDeposit(null);
  }

  const days = nextDays();

  return (
    <Sheet
      open={!!service}
      onClose={onClose}
      title={service ? (deposit ? "Deposit" : `${appointmentId ? "Reschedule" : "Book"} · ${service.name}`) : undefined}
      cta={
        deposit ? undefined : (
          <button className="btn-black" disabled={!slot || pending} onClick={confirm}>
            {pending ? "Confirming…" : "Confirm booking"}
          </button>
        )
      }
    >
      {deposit ? (
        settling ? (
          <p style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 15 }}>Confirming your booking…</p>
        ) : (
          <>
            <p style={{ color: "var(--muted)", fontSize: 15, paddingBottom: 8 }}>
              This clinic asks for a deposit to hold your appointment. Your slot is reserved until you pay.
            </p>
            <CardPayment payment={deposit.payment} amountCents={deposit.amountCents} currency={currency} onPaid={afterDeposit} onCancel={cancelDeposit} />
          </>
        )
      ) : (
        <>
      {options && options.staff.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 15 }}>
          No practitioner is assigned to this treatment yet. Please call the clinic to book.
        </p>
      ) : (
        <>
          <div className="grouplab">Date</div>
          <div className="chipsel">
            {days.map((d) => (
              <button key={d.iso} className={`schip ${date === d.iso ? "on" : ""}`} onClick={() => setDate(d.iso)}>
                {d.label}
              </button>
            ))}
          </div>

          <div className="grouplab">Time</div>
          {loading ? (
            <p style={{ color: "var(--muted)", fontSize: 15, padding: "6px 0 14px" }}>Checking availability…</p>
          ) : slots.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 15, padding: "6px 0 14px" }}>
              Nothing free that day. Try another date.
            </p>
          ) : (
            <div className="chipsel">
              {slots.map((s) => (
                <button key={s} className={`schip ${slot === s ? "on" : ""}`} onClick={() => setSlot(s)}>
                  {new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </button>
              ))}
            </div>
          )}

          {options && options.staff.length > 1 && (
            <>
              <div className="grouplab">Practitioner</div>
              <div className="chipsel">
                {options.staff.map((s) => (
                  <button key={s.id} className={`schip ${staffId === s.id ? "on" : ""}`} onClick={() => setStaffId(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {options && options.locations.length > 1 && (
            <>
              <div className="grouplab">Location</div>
              <div className="chipsel">
                {options.locations.map((l) => (
                  <button key={l.id} className={`schip ${locationId === l.id ? "on" : ""}`} onClick={() => setLocationId(l.id)}>
                    {l.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <p style={{ color: "var(--danger)", fontSize: 14 }}>{error}</p>}
        </>
      )}
        </>
      )}
    </Sheet>
  );
}

function nextDays() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + 1 + i);
    d.setHours(0, 0, 0, 0);
    return {
      iso: d.toISOString(),
      label: d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }),
    };
  });
}
