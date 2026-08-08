import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { AppointmentsView } from "./appointments-view";
import type { AppointmentStatus } from "@prisma/client";

const STATUS_FILTERS: Record<string, AppointmentStatus[] | undefined> = {
  upcoming: ["REQUESTED", "CONFIRMED"],
  requested: ["REQUESTED"],
  confirmed: ["CONFIRMED"],
  completed: ["COMPLETED"],
  cancelled: ["CANCELLED"],
  "no-show": ["NO_SHOW"],
};

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ status?: string; view?: string; q?: string }>;
}) {
  const { merchantId } = await params;
  const { status = "upcoming", view = "list", q = "" } = await searchParams;
  const ctx = await requireMerchantContext(merchantId);

  const statuses = STATUS_FILTERS[status] ?? STATUS_FILTERS.upcoming!;

  const appointments = await ctx.db.appointment.findMany({
    where: {
      status: { in: statuses },
      ...(status === "upcoming" ? { startAt: { gte: new Date() } } : {}),
      ...(q
        ? {
            customerProfile: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" as const } },
                { lastName: { contains: q, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    orderBy: { startAt: status === "upcoming" || status === "requested" ? "asc" : "desc" },
    take: 100,
    include: {
      customerProfile: { select: { firstName: true, lastName: true } },
      service: { select: { name: true, durationMinutes: true } },
      staffProfile: { select: { firstName: true, lastName: true } },
      location: { select: { name: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <MerchantPageHeader title="Appointments" merchantName={ctx.merchantName} />
      <AppointmentsView
        merchantId={merchantId}
        status={status}
        view={view === "calendar" ? "calendar" : "list"}
        q={q}
        appointments={appointments.map((a) => ({
          id: a.id,
          client: `${a.customerProfile.firstName} ${a.customerProfile.lastName}`.trim(),
          service: a.service.name,
          staff: `${a.staffProfile.firstName} ${a.staffProfile.lastName}`.trim(),
          location: a.location.name,
          startAt: a.startAt.toISOString(),
          endAt: a.endAt.toISOString(),
          status: a.status,
          notes: a.notes,
        }))}
      />
    </div>
  );
}
