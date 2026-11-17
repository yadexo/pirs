"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toaster";
import { setInAppBookingsAction } from "@/lib/actions/merchants";

/**
 * The app's own booking, per clinic. Off by default: clinics book through
 * their own software and the app links to it per treatment. Only a platform
 * admin can switch it on; switching it off hides booking and deletes nothing.
 */
export function BookingsPanel({ merchantId, on }: { merchantId: string; on: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function flip() {
    setPending(true);
    const result = await setInAppBookingsAction(merchantId, !on);
    setPending(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(result.inAppBookings ? "In-app bookings switched on" : "In-app bookings switched off");
    router.refresh();
  }

  return (
    <section className="mt-6 rounded-card border border-border bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">In-app bookings</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            In-app bookings <Pill tone={on ? "green" : "neutral"}>{on ? "On" : "Off"}</Pill>
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            {on
              ? "Clients book, reschedule and cancel appointments in the app, and the clinic manages them in its portal."
              : "Clients buy treatments and book through the clinic's own booking page. The app's booking, appointments and their settings are hidden."}
          </p>
        </div>
        <Button variant={on ? "outline" : "primary"} loading={pending} onClick={flip}>
          {on ? "Switch off" : "Switch on"}
        </Button>
      </div>
    </section>
  );
}
