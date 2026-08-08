import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDate } from "@/lib/utils";
import { Tag } from "lucide-react";

export default async function PromotionsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const promotions = await db.promotion.findMany({
    where: { active: true, startAt: { lte: new Date() }, endAt: { gte: new Date() } },
    orderBy: { endAt: "asc" },
  });

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Promotions</h1>
      {promotions.length === 0 ? (
        <EmptyState icon={<Tag className="h-6 w-6" />} title="No active promotions right now" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {promotions.map((promo) => (
            <Card key={promo.id}>
              <CardContent className="p-4">
                <Badge tone="brand">{promo.discountType === "PERCENT" ? `${promo.discountValue}% off` : formatMoney(promo.discountValue) + " off"}</Badge>
                <p className="mt-2 font-medium">{promo.title}</p>
                {promo.description && <p className="mt-1 text-sm text-ink-muted">{promo.description}</p>}
                <p className="mt-2 text-xs text-ink-subtle">
                  {promo.code ? `Code: ${promo.code} · ` : ""}Ends {formatDate(promo.endAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
