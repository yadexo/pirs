import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { Gift, Sparkles } from "lucide-react";

export default async function LoyaltyPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const [profile, programme, transactions] = await Promise.all([
    db.customerProfile.findFirst({ where: { id: user.customerProfileId! } }),
    db.loyaltyProgramme.findFirst({ where: {}, include: { rewards: { where: { active: true }, orderBy: { pointsCost: "asc" } } } }),
    db.loyaltyTransaction.findMany({
      where: { customerProfileId: user.customerProfileId! },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const balance = profile?.loyaltyPointsBalance ?? 0;
  const nextReward = programme?.rewards.find((r) => r.pointsCost > balance);
  const rewardsWithinReach = programme?.rewards.filter((r) => r.pointsCost <= balance) ?? [];

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Rewards</h1>

      <Card className="bg-brand-primary text-brand-primary-foreground">
        <CardContent className="p-5">
          <p className="text-sm opacity-90">Your balance</p>
          <p className="text-3xl font-semibold">{balance} pts</p>
          {nextReward && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${Math.min(100, (balance / nextReward.pointsCost) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs opacity-90">
                {nextReward.pointsCost - balance} pts to unlock &ldquo;{nextReward.name}&rdquo;
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {programme?.rewards.length ? (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Gift className="h-4 w-4" /> Available rewards
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {programme.rewards.map((reward) => {
              const unlocked = rewardsWithinReach.some((r) => r.id === reward.id);
              return (
                <Card key={reward.id} className={unlocked ? "" : "opacity-60"}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{reward.name}</p>
                      <Badge tone={unlocked ? "success" : "neutral"}>{reward.pointsCost} pts</Badge>
                    </div>
                    {reward.description && <p className="mt-1 text-xs text-ink-muted">{reward.description}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No rewards configured yet" />
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">History</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-ink-muted">No points activity yet.</p>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p>{tx.reason ?? tx.type}</p>
                    <p className="text-xs text-ink-subtle">
                      {formatDate(tx.createdAt)}
                      {tx.expiresAt ? ` · expires ${formatDate(tx.expiresAt)}` : ""}
                    </p>
                  </div>
                  <span className={tx.points >= 0 ? "font-medium text-success" : "font-medium text-danger"}>
                    {tx.points >= 0 ? "+" : ""}
                    {tx.points}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
