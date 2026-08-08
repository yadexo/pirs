"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { cancelAppointmentAction, rescheduleAppointmentAction, getSlotsAction } from "@/lib/actions/appointments";
import { formatTimeFromMinutes, formatDate } from "@/lib/utils";

export function CancelAppointmentButton({ tenantSlug, appointmentId }: { tenantSlug: string; appointmentId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel appointment?"
        confirmLabel="Cancel appointment"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            try {
              await cancelAppointmentAction(tenantSlug, appointmentId);
              toast.success("Appointment cancelled");
              setOpen(false);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not cancel");
            }
          })
        }
      />
    </>
  );
}

export function RescheduleButton({
  tenantSlug,
  appointmentId,
  staffProfileId,
  locationId,
  durationMinutes,
}: {
  tenantSlug: string;
  appointmentId: string;
  staffProfileId: string;
  locationId: string;
  durationMinutes: number;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  async function loadSlots(nextDate: string) {
    setDate(nextDate);
    const result = await getSlotsAction(staffProfileId, locationId, durationMinutes, new Date(nextDate).toISOString());
    setSlots(result);
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void loadSlots(date);
        }}
      >
        Reschedule
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Reschedule appointment">
        <div className="space-y-3">
          <input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => void loadSlots(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          />
          <p className="text-sm text-ink-muted">{formatDate(new Date(date))}</p>
          {slots.length === 0 ? (
            <p className="text-sm text-ink-subtle">No availability this day.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((iso) => {
                const d = new Date(iso);
                const minutes = d.getHours() * 60 + d.getMinutes();
                return (
                  <button
                    key={iso}
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await rescheduleAppointmentAction(tenantSlug, appointmentId, iso);
                          toast.success("Appointment rescheduled");
                          setOpen(false);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Could not reschedule");
                        }
                      })
                    }
                    className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
                  >
                    {formatTimeFromMinutes(minutes)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
