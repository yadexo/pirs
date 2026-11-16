"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Sheet, useToast } from "@/components/client-app/ui";
import { getBookingOptionsForServiceAction, getClientSlotsAction, clientBookAction, clientOrderStatusAction, clientAbandonOrderAction } from "@/lib/actions/client-app";
import { CardPayment, type PaymentHandoff } from "../card-payment";
import { formatTime, formatWeekday } from "@/lib/client-format";
import { useClinicTimeZone } from "../base-path";
/** All this sheet needs of a treatment; the shop's cards carry much more. */
export interface BookableService {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

interface Options {
  durationMinutes: number;
  staff: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  /** The clinic's next seven calendar days, "YYYY-MM-DD". */
  days: string[];
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
  service: BookableService | null;
  /** Set when rescheduling an existing appointment. */
  appointmentId?: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const timeZone = useClinicTimeZone();
  const { toast } = useToast();
  const t = useTranslations("clientApp.booking");
  const [options, setOptions] = React.useState<Options | null>(null);
  const [staffId, setStaffId] = React.useState("");
  const [locationId, setLocationId] = React.useState("");
  /** One of the clinic's calendar days, "2026-11-19", as the server listed them. */
  const [date, setDate] = React.useState("");
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
      setDate((current) => (o.days.includes(current) ? current : (o.days[0] ?? "")));
      setStaffId(o.staff[0]?.id ?? "");
      setLocationId(o.locations[0]?.id ?? "");
    });
  }, [service]);

  React.useEffect(() => {
    if (!service || !options || !staffId || !locationId || !date) return;
    setLoading(true);
    setSlot(null);
    getClientSlotsAction(staffId, locationId, options.durationMinutes, date)
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
    toast(appointmentId ? t("appointmentUpdated") : t("bookingRequested"));
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
        setError(t("paymentFailedPickAgain"));
        return;
      } else await new Promise((r) => setTimeout(r, 700));
    }
    setSettling(false);
    setDeposit(null);
    toast(confirmed ? t("bookingConfirmed") : t("depositReceivedConfirming"));
    onBooked();
  }

  async function cancelDeposit() {
    if (deposit) await clientAbandonOrderAction(merchantSlug, deposit.orderNumber).catch(() => undefined);
    setDeposit(null);
  }

  const days = (options?.days ?? []).map((iso) => ({ iso, label: dayLabel(iso) }));

  return (
    <Sheet
      open={!!service}
      onClose={onClose}
      title={service ? (deposit ? t("deposit") : `${appointmentId ? t("reschedule") : t("book")} · ${service.name}`) : undefined}
      cta={
        deposit ? undefined : (
          <button className="btn-black" disabled={!slot || pending} onClick={confirm}>
            {pending ? t("confirming") : t("confirmBooking")}
          </button>
        )
      }
    >
      {deposit ? (
        settling ? (
          <p style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 15 }}>{t("confirmingYourBooking")}</p>
        ) : (
          <>
            <p style={{ color: "var(--muted)", fontSize: 15, paddingBottom: 8 }}>{t("depositNotice")}</p>
            <CardPayment
              payment={deposit.payment}
              orderNumber={deposit.orderNumber}
              amountCents={deposit.amountCents}
              currency={currency}
              onPaid={afterDeposit}
              onCancel={cancelDeposit}
            />
          </>
        )
      ) : (
        <>
      {options && options.staff.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 15 }}>{t("noPractitionerAssigned")}</p>
      ) : (
        <>
          <div className="grouplab">{t("date")}</div>
          <div className="chipsel">
            {days.map((d) => (
              <button key={d.iso} className={`schip ${date === d.iso ? "on" : ""}`} onClick={() => setDate(d.iso)}>
                {d.label}
              </button>
            ))}
          </div>

          <div className="grouplab">{t("time")}</div>
          {loading ? (
            <p style={{ color: "var(--muted)", fontSize: 15, padding: "6px 0 14px" }}>{t("checkingAvailability")}</p>
          ) : slots.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 15, padding: "6px 0 14px" }}>{t("nothingFreeThatDay")}</p>
          ) : (
            <div className="chipsel">
              {slots.map((s) => (
                <button key={s} className={`schip ${slot === s ? "on" : ""}`} onClick={() => setSlot(s)}>
                  {formatTime(s, timeZone)}
                </button>
              ))}
            </div>
          )}

          {options && options.staff.length > 1 && (
            <>
              <div className="grouplab">{t("practitioner")}</div>
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
              <div className="grouplab">{t("location")}</div>
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

/**
 * "Thu 19 Nov" for a calendar day. Formatted as a date in UTC, because the
 * day is already the clinic's: reading it in any real zone could move it.
 */
function dayLabel(day: string) {
  return formatWeekday(new Date(`${day}T12:00:00Z`), "UTC");
}
