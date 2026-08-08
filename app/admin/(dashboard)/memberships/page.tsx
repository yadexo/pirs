import Link from "next/link";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Plus, CreditCard } from "lucide-react";
import { ArchivePlanButton } from "./client";

export default async function AdminMembershipsPage() {
  await requirePermission("memberships.manage");
  const { db } = await requireStaffContext();

  const plans = await db.membershipPlan.findMany({
    where: { active: true },
    include: { _count: { select: { customerMemberships: true } } },
    orderBy: { priceCents: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Membership plans</h1>
          <p className="text-sm text-ink-muted">Recurring plans customers can join.</p>
        </div>
        <Link href="/admin/memberships/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New plan
          </Button>
        </Link>
      </div>

      {plans.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-6 w-6" />} title="No membership plans yet" />
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{plan.name}</p>
                  <p className="text-xs text-ink-subtle">
                    {formatMoney(plan.priceCents)} / {plan.billingFrequency === "MONTHLY" ? "mo" : "yr"} ·{" "}
                    {plan._count.customerMemberships} member{plan._count.customerMemberships === 1 ? "" : "s"}
                  </p>
                </div>
                <ArchivePlanButton id={plan.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
