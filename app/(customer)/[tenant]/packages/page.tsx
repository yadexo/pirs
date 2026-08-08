import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Boxes } from "lucide-react";

export default async function PackagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const packages = await db.package.findMany({
    where: { active: true },
    include: { items: { include: { service: true } } },
    orderBy: { priceCents: "asc" },
  });

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Packages</h1>
      {packages.length === 0 ? (
        <EmptyState icon={<Boxes className="h-6 w-6" />} title="No packages available" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {packages.map((pkg) => {
            const individualTotal = pkg.items.reduce((sum, i) => sum + i.service.priceCents * i.quantity, 0);
            const savingsPct = individualTotal > 0 ? Math.round((1 - pkg.priceCents / individualTotal) * 100) : 0;
            return (
              <Link key={pkg.id} href={`/${tenantSlug}/packages/${pkg.id}`}>
                <Card className="h-full transition-shadow hover:shadow-raised">
                  <CardContent className="p-4">
                    <p className="font-medium">{pkg.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">{pkg.totalUses} uses · {pkg.items.map((i) => i.service.name).join(", ")}</p>
                    <div className="mt-2 flex items-center justify-between">
                      {savingsPct > 0 ? <span className="text-xs font-medium text-success">Save {savingsPct}%</span> : <span />}
                      <span className="font-semibold">{formatMoney(pkg.priceCents)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
