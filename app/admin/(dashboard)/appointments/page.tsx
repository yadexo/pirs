import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { CalendarDays } from "lucide-react";
import { AppointmentStatusActions } from "./client";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  REQUESTED: "warning",
  CONFIRMED: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
  NO_SHOW: "danger",
};

export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePermission("appointments.manage");
  const { db } = await requireStaffContext();
  const { status } = await searchParams;

  const appointments = await db.appointment.findMany({
    where: status ? { status: status as never } : { status: { in: ["REQUESTED", "CONFIRMED"] } },
    include: { customerProfile: true, service: true, staffProfile: true, location: true },
    orderBy: { startAt: "asc" },
    take: 100,
  });

  const filters = [
    { label: "Upcoming", value: "" },
    { label: "Requested", value: "REQUESTED" },
    { label: "Confirmed", value: "CONFIRMED" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Cancelled", value: "CANCELLED" },
    { label: "No-show", value: "NO_SHOW" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Appointments</h1>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {filters.map((f) => (
          <a
            key={f.value}
            href={`/admin/appointments${f.value ? `?status=${f.value}` : ""}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${(status ?? "") === f.value ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border text-ink-muted"}`}
          >
            {f.label}
          </a>
        ))}
      </div>

      {appointments.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No appointments found" />
      ) : (
        <div className="space-y-2">
          {appointments.map((appt) => (
            <Card key={appt.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">
                    {appt.customerProfile.firstName} {appt.customerProfile.lastName} · {appt.service.name}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {formatDateTime(appt.startAt)} · {appt.staffProfile.firstName} {appt.staffProfile.lastName} · {appt.location.name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[appt.status]}>{appt.status}</Badge>
                  <AppointmentStatusActions appointmentId={appt.id} status={appt.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
