import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Layers } from "lucide-react";

export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { q, category } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const [categories, services] = await Promise.all([
    db.serviceCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.service.findMany({
      where: {
        active: true,
        categoryId: category || undefined,
        name: q ? { contains: q, mode: "insensitive" } : undefined,
      },
      orderBy: { sortOrder: "asc" },
      include: { category: true },
    }),
  ]);

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Services</h1>

      <form className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Search services…" className="flex-1" />
      </form>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        <Link
          href={`/${tenantSlug}/services`}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${!category ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border text-ink-muted"}`}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/${tenantSlug}/services?category=${c.id}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${category === c.id ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border text-ink-muted"}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {services.length === 0 ? (
        <EmptyState icon={<Layers className="h-6 w-6" />} title="No services found" description="Try a different search or category." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => (
            <Link key={service.id} href={`/${tenantSlug}/services/${service.id}`}>
              <Card className="h-full transition-shadow hover:shadow-raised">
                <CardContent className="p-4">
                  <p className="text-xs text-ink-subtle">{service.category.name}</p>
                  <p className="mt-1 font-medium">{service.name}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-ink-muted">{service.durationMinutes} min</span>
                    <span className="font-semibold">{formatMoney(service.priceCents)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
