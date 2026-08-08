import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { Clock } from "lucide-react";
import { AddToBasketButton } from "@/components/customer/add-to-basket-button";
import { addServiceToBasketAction } from "@/lib/actions/basket";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant: tenantSlug, id } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const service = await db.service.findFirst({ where: { id, active: true }, include: { category: true } });
  if (!service) notFound();

  const session = await auth();
  const isAuthenticated = session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug;

  return (
    <div className="space-y-4 py-4">
      {service.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={service.imageUrl} alt={service.name} className="h-48 w-full rounded-lg object-cover" />
      )}
      <div>
        <p className="text-xs text-ink-subtle">{service.category.name}</p>
        <h1 className="text-xl font-semibold">{service.name}</h1>
        <div className="mt-1 flex items-center gap-3 text-sm text-ink-muted">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {service.durationMinutes} min
          </span>
          <span className="font-semibold text-ink">{formatMoney(service.priceCents)}</span>
        </div>
      </div>

      {service.description && (
        <Card>
          <CardContent className="p-4 text-sm text-ink-muted">{service.description}</CardContent>
        </Card>
      )}

      {(service.prepInstructions || service.aftercareInstructions) && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {service.prepInstructions && (
              <div>
                <p className="text-sm font-medium">Before your appointment</p>
                <p className="text-sm text-ink-muted">{service.prepInstructions}</p>
              </div>
            )}
            {service.aftercareInstructions && (
              <div>
                <p className="text-sm font-medium">Aftercare</p>
                <p className="text-sm text-ink-muted">{service.aftercareInstructions}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        <AddToBasketButton
          isAuthenticated={!!isAuthenticated}
          loginHref={`/${tenantSlug}/login?next=/${tenantSlug}/services/${id}`}
          action={addServiceToBasketAction.bind(null, tenantSlug, service.id)}
          label="Add to basket"
        />
        <a href={`/${tenantSlug}/appointments/new?serviceId=${service.id}`}>
          <button className="h-10 w-full rounded-md border border-border text-sm font-medium hover:bg-surface-subtle">
            Book appointment
          </button>
        </a>
      </div>
    </div>
  );
}
