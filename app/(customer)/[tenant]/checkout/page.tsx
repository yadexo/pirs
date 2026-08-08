import { notFound, redirect } from "next/navigation";
import { requireCustomerContext } from "@/lib/rbac";
import { getTenantBySlug } from "@/lib/tenant";
import { getCheckoutQuoteAction } from "@/lib/actions/checkout";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import { PlaceOrderForm } from "./place-order-button";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ promoCode?: string; useCredit?: string; rewardId?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { promoCode = "", useCredit = "0", rewardId = "" } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const basket = await db.basket.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: "OPEN" },
    include: { items: { include: { service: true, product: true, package: true } } },
  });

  if (!basket || basket.items.length === 0) redirect(`/${tenantSlug}/basket`);

  const useCreditCents = Math.max(0, Math.round(Number(useCredit || 0) * 100));
  const quote = await getCheckoutQuoteAction(tenantSlug, promoCode || null, useCreditCents, rewardId || null);

  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
  const availableRewards =
    (profile?.loyaltyPointsBalance ?? 0) > 0
      ? await db.loyaltyReward.findMany({
          where: { active: true, pointsCost: { lte: profile?.loyaltyPointsBalance ?? 0 } },
          orderBy: { pointsCost: "asc" },
        })
      : [];

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Checkout</h1>

      <Card>
        <CardContent className="space-y-2 p-4">
          {basket.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span>
                {item.service?.name ?? item.product?.name ?? item.package?.name} × {item.quantity}
              </span>
              <span>{formatMoney(item.unitPriceCents * item.quantity)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <form className="flex items-end gap-2" method="GET">
            <input type="hidden" name="useCredit" value={useCredit} />
            <input type="hidden" name="rewardId" value={rewardId} />
            <div className="flex-1">
              <Label htmlFor="promoCode">Promo code</Label>
              <Input id="promoCode" name="promoCode" defaultValue={promoCode} placeholder="e.g. WELCOME10" />
            </div>
            <Button type="submit" variant="outline" size="md">
              Apply
            </Button>
          </form>
          {promoCode && quote.promoError && <p className="text-sm text-danger">{quote.promoError}</p>}

          {availableRewards.length > 0 && (
            <form className="flex items-end gap-2" method="GET">
              <input type="hidden" name="promoCode" value={promoCode} />
              <input type="hidden" name="useCredit" value={useCredit} />
              <div className="flex-1">
                <Label htmlFor="rewardId">Redeem a reward</Label>
                <Select id="rewardId" name="rewardId" defaultValue={rewardId}>
                  <option value="">None</option>
                  {availableRewards.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.pointsCost} pts
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="outline" size="md">
                Apply
              </Button>
            </form>
          )}
          {rewardId && quote.loyaltyError && <p className="text-sm text-danger">{quote.loyaltyError}</p>}

          {quote.availableCredit > 0 && (
            <form className="flex items-end gap-2" method="GET">
              <input type="hidden" name="promoCode" value={promoCode} />
              <input type="hidden" name="rewardId" value={rewardId} />
              <div className="flex-1">
                <Label htmlFor="useCredit">Use account credit (up to {formatMoney(quote.availableCredit)})</Label>
                <Input
                  id="useCredit"
                  name="useCredit"
                  type="number"
                  step="0.01"
                  min="0"
                  max={(quote.availableCredit / 100).toFixed(2)}
                  defaultValue={useCredit}
                />
              </div>
              <Button type="submit" variant="outline" size="md">
                Apply
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span>{formatMoney(quote.subtotalCents)}</span>
          </div>
          {quote.discountCents > 0 && (
            <div className="flex justify-between text-success">
              <span>Promo discount</span>
              <span>-{formatMoney(quote.discountCents)}</span>
            </div>
          )}
          {quote.loyaltyDiscountCents > 0 && (
            <div className="flex justify-between text-success">
              <span>Reward ({quote.rewardPointsCost} pts)</span>
              <span>-{formatMoney(quote.loyaltyDiscountCents)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-ink-muted">Tax</span>
            <span>{formatMoney(quote.taxCents)}</span>
          </div>
          {quote.creditAppliedCents > 0 && (
            <div className="flex justify-between text-success">
              <span>Account credit</span>
              <span>-{formatMoney(quote.creditAppliedCents)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
            <span>Total</span>
            <span>{formatMoney(quote.totalCents)}</span>
          </div>
        </CardContent>
      </Card>

      <PlaceOrderForm
        tenantSlug={tenantSlug}
        promoCode={promoCode}
        useCreditDollars={useCredit}
        rewardId={rewardId}
        showSimulateFailure={process.env.PAYMENT_PROVIDER !== "stripe"}
      />
    </div>
  );
}
