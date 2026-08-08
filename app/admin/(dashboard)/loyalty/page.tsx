import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Gift } from "lucide-react";
import { ProgrammeSettingsForm, NewRewardForm, ArchiveRewardButton } from "./client";

export default async function AdminLoyaltyPage() {
  await requirePermission("loyalty.adjust");
  const { db } = await requireStaffContext();

  const [programme, services, products] = await Promise.all([
    db.loyaltyProgramme.findFirst({ where: {}, include: { rewards: { where: { active: true } } } }),
    db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Loyalty programme</h1>

      <Card>
        <CardHeader>
          <CardTitle>Earning rules</CardTitle>
        </CardHeader>
        <CardContent>
          <ProgrammeSettingsForm programme={programme} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-muted">Rewards</h2>
        <NewRewardForm services={services} products={products} />
      </div>

      {!programme || programme.rewards.length === 0 ? (
        <EmptyState icon={<Gift className="h-6 w-6" />} title="No rewards yet" description="Create a reward customers can redeem with points." />
      ) : (
        <div className="space-y-2">
          {programme.rewards.map((reward) => (
            <Card key={reward.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{reward.name}</p>
                  <p className="text-xs text-ink-subtle">
                    {reward.pointsCost} pts ·{" "}
                    {reward.rewardType === "DISCOUNT_PERCENT"
                      ? `${reward.discountPercent}% off`
                      : reward.rewardType === "DISCOUNT_AMOUNT"
                        ? `${formatMoney(reward.discountAmountCents ?? 0)} off`
                        : reward.rewardType.replace("_", " ").toLowerCase()}
                  </p>
                </div>
                <ArchiveRewardButton id={reward.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
