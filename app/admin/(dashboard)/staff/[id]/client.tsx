"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select, Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import {
  setStaffRoleAction,
  setStaffServicesAction,
  setStaffLocationsAction,
} from "@/lib/actions/staff";
import { setStaffAvailabilityAction, removeStaffAvailabilityAction } from "@/lib/actions/appointments";
import type { Role, Service, Location, StaffAvailability } from "@prisma/client";
import { useActionState } from "react";
import { Trash2 } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RoleAssignment({ staffProfileId, roles, currentRoleId }: { staffProfileId: string; roles: Role[]; currentRoleId: string | null }) {
  const [pending, startTransition] = useTransition();
  return (
    <Select
      defaultValue={currentRoleId ?? ""}
      disabled={pending}
      onChange={(e) =>
        startTransition(async () => {
          await setStaffRoleAction(staffProfileId, e.target.value);
          toast.success("Role updated");
        })
      }
    >
      <option value="">No role</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </Select>
  );
}

export function ServicesAssignment({ staffProfileId, services, assignedIds }: { staffProfileId: string; services: Service[]; assignedIds: string[] }) {
  const [pending, startTransition] = useTransition();
  const assigned = new Set(assignedIds);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await setStaffServicesAction(staffProfileId, formData);
          toast.success("Services updated");
        })
      }
      className="space-y-2"
    >
      <div className="grid gap-1 sm:grid-cols-2">
        {services.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={assigned.has(s.id)} />
            {s.name}
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" type="submit" loading={pending}>
        Save services
      </Button>
    </form>
  );
}

export function LocationsAssignment({ staffProfileId, locations, assignedIds }: { staffProfileId: string; locations: Location[]; assignedIds: string[] }) {
  const [pending, startTransition] = useTransition();
  const assigned = new Set(assignedIds);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await setStaffLocationsAction(staffProfileId, formData);
          toast.success("Locations updated");
        })
      }
      className="space-y-2"
    >
      <div className="grid gap-1 sm:grid-cols-2">
        {locations.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="locationIds" value={l.id} defaultChecked={assigned.has(l.id)} />
            {l.name}
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" type="submit" loading={pending}>
        Save locations
      </Button>
    </form>
  );
}

export function AvailabilityManager({ staffProfileId, availability }: { staffProfileId: string; availability: StaffAvailability[] }) {
  const [state, formAction] = useActionState(setStaffAvailabilityAction, undefined);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {availability.length === 0 && <p className="text-sm text-ink-muted">No working hours set.</p>}
        {availability.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
            <span>
              {DAYS[a.dayOfWeek]}: {String(Math.floor(a.startMinute / 60)).padStart(2, "0")}:{String(a.startMinute % 60).padStart(2, "0")} –{" "}
              {String(Math.floor(a.endMinute / 60)).padStart(2, "0")}:{String(a.endMinute % 60).padStart(2, "0")}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => removeStaffAvailabilityAction(a.id))}
              className="text-ink-subtle hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="staffProfileId" value={staffProfileId} />
        <div>
          <Label htmlFor="dayOfWeek">Day</Label>
          <Select id="dayOfWeek" name="dayOfWeek" className="w-36">
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="startTime">Start</Label>
          <Input id="startTime" name="startTime" type="time" defaultValue="09:00" className="w-28" />
        </div>
        <div>
          <Label htmlFor="endTime">End</Label>
          <Input id="endTime" name="endTime" type="time" defaultValue="17:00" className="w-28" />
        </div>
        <Button size="sm" type="submit">
          Add
        </Button>
      </form>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
    </div>
  );
}
