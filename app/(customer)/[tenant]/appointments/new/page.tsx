import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { EmptyState } from "@/components/ui/empty-state";
import { BookingWizard } from "./booking-wizard";

export default async function NewAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ serviceId?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { serviceId } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db } = await requireCustomerContext();
  const services = await db.service.findMany({
    where: { active: true, staff: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, durationMinutes: true },
  });

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Book an appointment</h1>
      {services.length === 0 ? (
        <EmptyState title="No bookable services" description="Check back once services have staff assigned." />
      ) : (
        <BookingWizard tenantSlug={tenantSlug} services={services} initialServiceId={serviceId} />
      )}
    </div>
  );
}
