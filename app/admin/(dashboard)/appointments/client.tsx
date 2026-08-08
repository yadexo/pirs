"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { updateAppointmentStatusAction } from "@/lib/actions/appointments";
import type { AppointmentStatus } from "@prisma/client";

export function AppointmentStatusActions({ appointmentId, status }: { appointmentId: string; status: AppointmentStatus }) {
  const [pending, startTransition] = useTransition();

  function run(next: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW") {
    startTransition(async () => {
      await updateAppointmentStatusAction(appointmentId, next);
      toast.success(`Marked ${next.toLowerCase()}`);
    });
  }

  if (status === "REQUESTED") {
    return (
      <div className="flex gap-1.5">
        <Button size="sm" loading={pending} onClick={() => run("CONFIRMED")}>
          Confirm
        </Button>
        <Button size="sm" variant="outline" loading={pending} onClick={() => run("CANCELLED")}>
          Decline
        </Button>
      </div>
    );
  }

  if (status === "CONFIRMED") {
    return (
      <div className="flex gap-1.5">
        <Button size="sm" loading={pending} onClick={() => run("COMPLETED")}>
          Complete
        </Button>
        <Button size="sm" variant="outline" loading={pending} onClick={() => run("NO_SHOW")}>
          No-show
        </Button>
        <Button size="sm" variant="ghost" loading={pending} onClick={() => run("CANCELLED")}>
          Cancel
        </Button>
      </div>
    );
  }

  return null;
}
