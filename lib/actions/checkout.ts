"use server";

import { nanoid } from "nanoid";
import { redirect } from "next/navigation";
import { requireCustomerContext } from "@/lib/rbac";
import { getPaymentProvider } from "@/lib/providers/payments";
import { awardPointsForOrder, adjustLoyaltyPoints } from "@/lib/loyalty";
import { computeCheckoutTotals, type LineItem } from "@/lib/checkout-calculations";
import type { TenantDb } from "@/lib/tenant-db";

async function loadBasket(db: TenantDb, customerProfileId: string) {
  return db.basket.findFirst({
    where: { customerProfileId, status: "OPEN" },
    include: { items: { include: { service: true, product: true, package: true } } },
  });
}

type BasketWithItems = NonNullable<Awaited<ReturnType<typeof loadBasket>>>;
type BasketItemWithCatalog = BasketWithItems["items"];

function toLineItems(items: BasketItemWithCatalog): LineItem[] {
  return items.map((i) => ({
    serviceId: i.serviceId,
    productId: i.productId,
    packageId: i.packageId,
    unitPriceCents: i.unitPriceCents,
    quantity: i.quantity,
    taxable: i.itemType === "SERVICE" ? (i.service?.taxable ?? true) : i.itemType === "PRODUCT" ? (i.product?.taxable ?? true) : true,
  }));
}

function findPromoByCode(db: TenantDb, code: string) {
  return db.promotion.findFirst({
    where: { code, active: true, startAt: { lte: new Date() }, endAt: { gte: new Date() } },
    include: { eligibility: true },
  });
}

type PromoWithEligibility = NonNullable<Awaited<ReturnType<typeof findPromoByCode>>>;

async function resolvePromotion(
  db: TenantDb,
  code: string,
  customerProfileId: string,
): Promise<{ error: string } | { promo: PromoWithEligibility }> {
  const promo = await findPromoByCode(db, code);
  if (!promo) return { error: "This promo code is not valid or has expired." };

  if (promo.usageLimit != null) {
    const used = await db.promotionRedemption.count({ where: { promotionId: promo.id } });
    if (used >= promo.usageLimit) return { error: "This promo code has reached its usage limit." };
  }
  if (promo.perCustomerLimit != null) {
    const used = await db.promotionRedemption.count({ where: { promotionId: promo.id, customerProfileId } });
    if (used >= promo.perCustomerLimit) return { error: "You've already used this promo code." } as const;
  }
  return { promo } as const;
}

export async function getCheckoutQuoteAction(
  tenantSlug: string,
  promoCode: string | null,
  useCreditCents: number,
  rewardId: string | null = null,
) {
  const { db, user } = await requireCustomerContext();
  const basket = await loadBasket(db, user.customerProfileId!);
  const items = basket?.items ?? [];
  const lineItems = toLineItems(items);

  const settings = await db.tenantSettings.findFirst({ where: {} });
  const taxRateBasisPoints = settings?.taxRateBasisPoints ?? 0;

  let promo: { discountType: "PERCENT" | "FIXED_AMOUNT"; discountValue: number; eligibility: { serviceId: string | null; productId: string | null; packageId: string | null }[] } | undefined;
  let promoError: string | null = null;
  if (promoCode) {
    const result = await resolvePromotion(db, promoCode, user.customerProfileId!);
    if ("error" in result) promoError = result.error;
    else promo = result.promo;
  }

  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });

  let reward: { rewardType: string; discountAmountCents: number | null; discountPercent: number | null } | undefined;
  let loyaltyError: string | null = null;
  let rewardPointsCost = 0;
  if (rewardId) {
    const rewardRow = await db.loyaltyReward.findFirst({ where: { id: rewardId, active: true } });
    if (!rewardRow) loyaltyError = "This reward is no longer available.";
    else if ((profile?.loyaltyPointsBalance ?? 0) < rewardRow.pointsCost) loyaltyError = "Not enough points for this reward.";
    else {
      rewardPointsCost = rewardRow.pointsCost;
      reward = rewardRow;
    }
  }

  const availableCredit = profile?.accountCreditBalanceCents ?? 0;
  const totals = computeCheckoutTotals({
    items: lineItems,
    promo,
    reward,
    taxRateBasisPoints,
    requestedCreditCents: useCreditCents,
    availableCreditCents: availableCredit,
  });

  return {
    ...totals,
    rewardPointsCost,
    availableCredit,
    availablePoints: profile?.loyaltyPointsBalance ?? 0,
    promoError,
    loyaltyError,
    itemCount: items.length,
  };
}

export async function placeOrderAction(
  tenantSlug: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string } | undefined> {
  const { db, user } = await requireCustomerContext();
  const promoCode = String(formData.get("promoCode") ?? "").trim() || null;
  const useCreditCents = Math.max(0, Math.round(Number(formData.get("useCreditDollars") ?? 0) * 100));
  const rewardId = String(formData.get("rewardId") ?? "").trim() || null;
  const simulateFailure = formData.get("simulateFailure") === "on";

  const basket = await loadBasket(db, user.customerProfileId!);
  const items = basket?.items ?? [];
  if (!basket || items.length === 0) return { error: "Your basket is empty." };

  for (const item of items) {
    if (item.itemType === "PRODUCT" && item.product && item.product.inventoryQuantity < item.quantity) {
      return { error: `${item.product.name} no longer has enough stock.` };
    }
  }

  const quote = await getCheckoutQuoteAction(tenantSlug, promoCode, useCreditCents, rewardId);
  if (quote.promoError) return { error: quote.promoError };
  if (quote.loyaltyError) return { error: quote.loyaltyError };

  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;

  let promotionId: string | null = null;
  if (promoCode && quote.discountCents > 0) {
    const promo = await db.promotion.findFirst({ where: { code: promoCode } });
    promotionId = promo?.id ?? null;
  }

  const order = await db.order.create({
    data: {
      customerProfileId: user.customerProfileId!,
      orderNumber,
      status: "PENDING",
      subtotalCents: quote.subtotalCents,
      discountCents: quote.discountCents,
      loyaltyDiscountCents: quote.loyaltyDiscountCents,
      loyaltyPointsRedeemed: quote.rewardPointsCost,
      taxCents: quote.taxCents,
      creditAppliedCents: quote.creditAppliedCents,
      totalCents: quote.totalCents,
      promotionId,
      promotionCode: promotionId ? promoCode : null,
      items: {
        create: items.map((i) => ({
          itemType: i.itemType,
          serviceId: i.serviceId,
          productId: i.productId,
          packageId: i.packageId,
          name: i.service?.name ?? i.product?.name ?? i.package?.name ?? "Item",
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.unitPriceCents * i.quantity,
          taxCents: 0,
        })),
      },
    } as never,
    include: { items: true },
  });

  const provider = getPaymentProvider();
  const intent = await provider.createIntent({
    amountCents: quote.totalCents,
    currency: "USD",
    customerRef: user.customerProfileId!,
    description: `Order ${orderNumber}`,
    simulateFailure,
  });

  await db.payment.create({
    data: {
      orderId: order.id,
      provider: "MOCK",
      providerPaymentId: intent.providerPaymentId,
      amountCents: quote.totalCents,
      status: intent.status,
      failureReason: intent.failureReason,
    } as never,
  });

  if (intent.status !== "SUCCEEDED") {
    await db.order.updateMany({ where: { id: order.id }, data: { status: "FAILED" } });
    redirect(`/${tenantSlug}/orders/${order.id}?status=failed`);
  }

  await db.order.updateMany({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });

  if (quote.creditAppliedCents > 0) {
    const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
    const newBalance = (profile?.accountCreditBalanceCents ?? 0) - quote.creditAppliedCents;
    await db.customerProfile.updateMany({
      where: { id: user.customerProfileId! },
      data: { accountCreditBalanceCents: newBalance },
    });
    await db.accountCreditTransaction.create({
      data: {
        customerProfileId: user.customerProfileId!,
        type: "REDEEMED",
        amountCents: -quote.creditAppliedCents,
        balanceAfterCents: newBalance,
        reason: `Applied to order ${orderNumber}`,
        relatedOrderId: order.id,
      } as never,
    });
  }

  if (rewardId && quote.rewardPointsCost > 0) {
    await adjustLoyaltyPoints(db, {
      customerProfileId: user.customerProfileId!,
      points: -quote.rewardPointsCost,
      type: "REDEEMED",
      reason: `Redeemed on order ${orderNumber}`,
      relatedOrderId: order.id,
      relatedRewardId: rewardId,
    });
  }

  await awardPointsForOrder(db, { id: order.id, customerProfileId: user.customerProfileId!, items: order.items });

  if (promotionId) {
    await db.promotionRedemption.create({
      data: {
        promotionId,
        customerProfileId: user.customerProfileId!,
        orderId: order.id,
        discountAppliedCents: quote.discountCents,
      } as never,
    });
  }

  for (const item of items) {
    if (item.itemType === "PRODUCT" && item.productId) {
      await db.product.updateMany({
        where: { id: item.productId },
        data: { inventoryQuantity: { decrement: item.quantity } },
      });
      await db.inventoryTransaction.create({
        data: {
          productId: item.productId,
          type: "SALE",
          quantityChange: -item.quantity,
          reason: `Order ${orderNumber}`,
          relatedOrderItemId: order.id,
        } as never,
      });
    }
    if (item.itemType === "PACKAGE" && item.packageId && item.package) {
      for (let n = 0; n < item.quantity; n++) {
        await db.customerPackage.create({
          data: {
            customerProfileId: user.customerProfileId!,
            packageId: item.packageId,
            remainingUses: item.package.totalUses,
            totalUses: item.package.totalUses,
            expiresAt: item.package.expiryDays
              ? new Date(Date.now() + item.package.expiryDays * 24 * 60 * 60 * 1000)
              : null,
            status: "ACTIVE",
          } as never,
        });
      }
    }
  }

  await db.basket.updateMany({ where: { id: basket.id }, data: { status: "CONVERTED" } });

  redirect(`/${tenantSlug}/orders/${order.id}?status=success`);
}
