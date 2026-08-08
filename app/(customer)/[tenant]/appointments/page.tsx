import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { CalendarDays, Plus } from "lucide-react";
import { CancelAppointmentButton, RescheduleButton } from "./client";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  REQUESTED: "warning",
  CONFIRMED: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
  NO_SHOW: "danger",
};

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ booked?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { booked } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const appointments = await db.appointment.findMany({
    where: { customerProfileId: user.customerProfileId! },
    include: { service: true, staffProfile: true, location: true },
    orderBy: { startAt: "desc" },
  });

  const now = new Date();
  const upcoming = appointments.filter((a) => a.startAt >= now && a.status !== "CANCELLED");
  const past = appointments.filter((a) => a.startAt < now || a.status === "CANCELLED");

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Appointments</h1>
        <Link href={`/${tenantSlug}/appointments/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4" /> Book
          </Button>
        </Link>
      </div>

      {booked === "1" && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 text-sm text-success">Your appointment is confirmed.</CardContent>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No upcoming appointments" />
        ) : (
          <div className="space-y-2">
            {upcoming.map((appt) => (
              <Card key={appt.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{appt.service.name}</p>
                      <p className="text-xs text-ink-subtle">
                        {formatDateTime(appt.startAt)} · with {appt.staffProfile.firstName} {appt.staffProfile.lastName} · {appt.location.name}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[appt.status]}>{appt.status}</Badge>
                  </div>
                  {appt.status !== "CANCELLED" && (
                    <div className="flex gap-2">
                      <RescheduleButton
                        tenantSlug={tenantSlug}
                        appointmentId={appt.id}
                        staffProfileId={appt.staffProfileId}
                        locationId={appt.locationId}
                        durationMinutes={appt.service.durationMinutes}
                      />
                      <CancelAppointmentButton tenantSlug={tenantSlug} appointmentId={appt.id} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">Past</h2>
          <div className="space-y-2">
            {past.map((appt) => (
              <Card key={appt.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{appt.service.name}</p>
                    <p className="text-xs text-ink-subtle">{formatDateTime(appt.startAt)}</p>
                  </div>
                  <Badge tone={STATUS_TONE[appt.status]}>{appt.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
