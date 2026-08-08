import Link from "next/link";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDate } from "@/lib/utils";
import { Plus, Tag } from "lucide-react";
import { ArchivePromotionButton } from "./client";

export default async function AdminPromotionsPage() {
  await requirePermission("promotions.create");
  const { db } = await requireStaffContext();

  const promotions = await db.promotion.findMany({
    include: { redemptions: true },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Promotions</h1>
        <Link href="/admin/promotions/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New promotion
          </Button>
        </Link>
      </div>

      {promotions.length === 0 ? (
        <EmptyState icon={<Tag className="h-6 w-6" />} title="No promotions yet" />
      ) : (
        <div className="space-y-2">
          {promotions.map((promo) => {
            const isLive = promo.active && promo.startAt <= now && promo.endAt >= now;
            const totalDiscount = promo.redemptions.reduce((sum, r) => sum + r.discountAppliedCents, 0);
            return (
              <Card key={promo.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">
                      {promo.title} {promo.code && <span className="font-mono text-xs text-ink-subtle">({promo.code})</span>}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatDate(promo.startAt)} – {formatDate(promo.endAt)} · {promo.redemptions.length} redemption
                      {promo.redemptions.length === 1 ? "" : "s"} · {formatMoney(totalDiscount)} given
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={isLive ? "success" : "neutral"}>{isLive ? "Active" : promo.active ? "Scheduled/Ended" : "Ended"}</Badge>
                    {promo.active && <ArchivePromotionButton id={promo.id} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
