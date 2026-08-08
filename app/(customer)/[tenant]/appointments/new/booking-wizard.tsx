"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { Select, Label, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { getBookingOptionsAction, getSlotsAction, bookAppointmentAction } from "@/lib/actions/appointments";
import { formatDate, formatTimeFromMinutes } from "@/lib/utils";

interface ServiceOption {
  id: string;
  name: string;
  durationMinutes: number;
}

export function BookingWizard({ tenantSlug, services, initialServiceId }: { tenantSlug: string; services: ServiceOption[]; initialServiceId?: string }) {
  const [serviceId, setServiceId] = useState(initialServiceId ?? services[0]?.id ?? "");
  const [staffOptions, setStaffOptions] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [locationOptions, setLocationOptions] = useState<{ id: string; name: string }[]>([]);
  const [staffProfileId, setStaffProfileId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loadingSlots, startLoadingSlots] = useTransition();
  const selectedService = services.find((s) => s.id === serviceId);

  const action = bookAppointmentAction.bind(null, tenantSlug);
  const [state, formAction] = useActionState(action, undefined);

  useEffect(() => {
    if (!serviceId) return;
    getBookingOptionsAction(serviceId).then((res) => {
      if (!res) return;
      setStaffOptions(res.staff.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName })));
      setLocationOptions(res.locations.map((l) => ({ id: l.id, name: l.name })));
      setStaffProfileId(res.staff[0]?.id ?? "");
      setLocationId(res.locations[0]?.id ?? "");
    });
  }, [serviceId]);

  useEffect(() => {
    if (!staffProfileId || !locationId || !selectedService) {
      setSlots([]);
      return;
    }
    setSelectedSlot(null);
    startLoadingSlots(async () => {
      const result = await getSlotsAction(staffProfileId, locationId, selectedService.durationMinutes, new Date(date).toISOString());
      setSlots(result);
    });
  }, [staffProfileId, locationId, date, selectedService]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="staffProfileId" value={staffProfileId} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="startAt" value={selectedSlot ?? ""} />

      <div>
        <Label htmlFor="service">Service</Label>
        <Select id="service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMinutes} min)
            </option>
          ))}
        </Select>
      </div>

      {staffOptions.length > 0 && (
        <div>
          <Label htmlFor="staff">Staff member</Label>
          <Select id="staff" value={staffProfileId} onChange={(e) => setStaffProfileId(e.target.value)}>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </Select>
        </div>
      )}

      {locationOptions.length > 1 && (
        <div>
          <Label htmlFor="location">Location</Label>
          <Select id="location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="date">Date</Label>
        <input
          id="date"
          type="date"
          value={date}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
        />
      </div>

      <div>
        <Label>Available times — {formatDate(new Date(date))}</Label>
        {loadingSlots ? (
          <p className="text-sm text-ink-subtle">Loading…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-ink-subtle">No availability this day. Try another date.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((iso) => {
              const d = new Date(iso);
              const minutes = d.getHours() * 60 + d.getMinutes();
              const active = selectedSlot === iso;
              return (
                <button
                  type="button"
                  key={iso}
                  onClick={() => setSelectedSlot(iso)}
                  className={`rounded-md border px-2 py-1.5 text-sm ${active ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border hover:bg-surface-subtle"}`}
                >
                  {formatTimeFromMinutes(minutes)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>

      <FieldError>{state?.error}</FieldError>
      <SubmitButton disabled={!selectedSlot}>Confirm booking</SubmitButton>
    </form>
  );
}
