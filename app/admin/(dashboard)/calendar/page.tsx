import Link from "next/link";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimeFromMinutes } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  REQUESTED: "warning",
  CONFIRMED: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
  NO_SHOW: "danger",
};

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requirePermission("appointments.manage");
  const { db } = await requireStaffContext();
  const { date } = await searchParams;

  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  const dayStart = new Date(dateStr);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [staff, appointments] = await Promise.all([
    db.staffProfile.findMany({ where: { active: true }, orderBy: { firstName: "asc" } }),
    db.appointment.findMany({
      where: { startAt: { gte: dayStart, lt: dayEnd }, status: { in: ["REQUESTED", "CONFIRMED", "COMPLETED"] } },
      include: { customerProfile: true, service: true },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Link href={`/admin/calendar?date=${addDays(dateStr, -1)}`} className="rounded-md border border-border p-1.5 hover:bg-surface-subtle">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm font-medium">{dayStart.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          <Link href={`/admin/calendar?date=${addDays(dateStr, 1)}`} className="rounded-md border border-border p-1.5 hover:bg-surface-subtle">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(staff.length, 1)}, minmax(180px, 1fr))` }}>
        {staff.map((s) => {
          const dayAppointments = appointments.filter((a) => a.staffProfileId === s.id);
          return (
            <div key={s.id}>
              <p className="mb-2 text-sm font-medium text-ink-muted">
                {s.firstName} {s.lastName}
              </p>
              <div className="space-y-2">
                {dayAppointments.length === 0 ? (
                  <p className="text-xs text-ink-subtle">No appointments</p>
                ) : (
                  dayAppointments.map((appt) => (
                    <Card key={appt.id}>
                      <CardContent className="p-3">
                        <p className="text-xs font-medium">
                          {formatTimeFromMinutes(appt.startAt.getHours() * 60 + appt.startAt.getMinutes())}
                        </p>
                        <p className="text-sm">{appt.customerProfile.firstName} {appt.customerProfile.lastName}</p>
                        <p className="text-xs text-ink-subtle">{appt.service.name}</p>
                        <Badge tone={STATUS_TONE[appt.status]} className="mt-1">
                          {appt.status}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
