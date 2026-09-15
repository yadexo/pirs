"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCustomerContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { getAvailableSlots } from "@/lib/availability";
import { adjustLoyaltyPoints, InsufficientPointsError, rewardDiscountCents } from "@/lib/loyalty";
import { getPaymentProvider } from "@/lib/providers/payments";
import { writeAuditLog } from "@/lib/audit";
import { nanoid } from "nanoid";
import { tenantCurrency } from "@/lib/currency";

/**
 * Every mutating action the patient app can perform.
 *
 * These write to the same tenant-scoped tables the clinic portal reads, so a
 * booking here shows up in /m/:id/appointments, a purchase in /m/:id/shop,
 * and points on the client's row in /m/:id/clients. Nothing is mocked.
 */

function revalidateClient(slug: string) {
  revalidatePath(`/app/${slug}`, "layout");
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export async function getBookingOptionsForServiceAction(serviceId: string) {
  const { db } = await requireCustomerContext();

  const [service, staff, locations] = await Promise.all([
    db.service.findFirst({ where: { id: serviceId, active: true } }),
    db.staffProfile.findMany({
      where: { active: true, services: { some: { serviceId } } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    db.location.findMany({ where: { active: true }, orderBy: { isPrimary: "desc" }, select: { id: true, name: true } }),
  ]);
  if (!service) return null;

  return {
    durationMinutes: service.durationMinutes,
    staff: staff.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim() })),
    locations,
  };
}

export async function getClientSlotsAction(staffProfileId: string, locationId: string, durationMinutes: number, dateIso: string) {
  const { db } = await requireCustomerContext();
  const slots = await getAvailableSlots(db, {
    staffProfileId,
    locationId,
    serviceDurationMinutes: durationMinutes,
    date: new Date(dateIso),
  });
  return slots.map((s) => s.toISOString());
}

const bookSchema = z.object({
  serviceId: z.string().min(1),
  staffProfileId: z.string().min(1),
  locationId: z.string().min(1),
  startAtIso: z.string().min(1),
});

export async function clientBookAction(
  slug: string,
  input: { serviceId: string; staffProfileId: string; locationId: string; startAtIso: string; appointmentId?: string },
): Promise<{ error: string } | { ok: true; when: string }> {
  const { db, user } = await requireCustomerContext();

  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return { error: "Please choose a service, staff member and time." };

  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) return { error: "That treatment is no longer available." };

  const startAt = new Date(input.startAtIso);
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000);

  // Re-check availability at commit time so two clients can't take one slot.
  const slots = await getAvailableSlots(db, {
    staffProfileId: input.staffProfileId,
    locationId: input.locationId,
    serviceDurationMinutes: service.durationMinutes,
    date: startAt,
  });
  const free = slots.some((s) => s.getTime() === startAt.getTime());
  if (!free && !input.appointmentId) return { error: "That time was just taken. Please pick another." };

  if (input.appointmentId) {
    const existing = await db.appointment.findFirst({
      where: { id: input.appointmentId, customerProfileId: user.customerProfileId! },
    });
    if (!existing) return { error: "Appointment not found." };
    await db.appointment.updateMany({
      where: { id: input.appointmentId },
      data: { startAt, endAt, staffProfileId: input.staffProfileId, locationId: input.locationId, status: "CONFIRMED" },
    });
  } else {
    await db.appointment.create({
      data: {
        customerProfileId: user.customerProfileId!,
        serviceId: input.serviceId,
        staffProfileId: input.staffProfileId,
        locationId: input.locationId,
        startAt,
        endAt,
        status: "REQUESTED",
      } as never,
    });
  }

  revalidateClient(slug);
  return { ok: true, when: startAt.toISOString() };
}

export async function clientCancelAppointmentAction(slug: string, appointmentId: string): Promise<{ error: string } | { ok: true }> {
  const { db, user } = await requireCustomerContext();

  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, customerProfileId: user.customerProfileId! },
  });
  if (!appt) return { error: "Appointment not found." };

  const settings = await db.tenantSettings.findFirst({ where: {} });
  const noticeHours = settings?.appointmentCancellationHours ?? 24;
  const hoursUntil = (appt.startAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < noticeHours) return { error: `Cancellations need ${noticeHours} hours notice. Please call the clinic.` };

  await db.appointment.updateMany({
    where: { id: appointmentId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "CUSTOMER" },
  });

  revalidateClient(slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cart & checkout
// ---------------------------------------------------------------------------

export async function clientAddToCartAction(
  slug: string,
  kind: "product" | "service",
  id: string,
  qty: number,
): Promise<{ error: string } | { ok: true }> {
  const { db, user } = await requireCustomerContext();

  const basket =
    (await db.basket.findFirst({ where: { customerProfileId: user.customerProfileId!, status: "OPEN" } })) ??
    (await db.basket.create({ data: { customerProfileId: user.customerProfileId!, status: "OPEN" } as never }));

  if (kind === "product") {
    const product = await db.product.findFirst({ where: { id, active: true } });
    if (!product) return { error: "Product not found." };
    if (product.inventoryQuantity < qty) return { error: "Not enough stock." };
    const line = await db.basketItem.findFirst({ where: { basketId: basket.id, productId: id } });
    if (line) await db.basketItem.updateMany({ where: { id: line.id }, data: { quantity: { increment: qty } } });
    else
      await db.basketItem.create({
        data: { basketId: basket.id, itemType: "PRODUCT", productId: id, quantity: qty, unitPriceCents: product.priceCents },
      });
  } else {
    const service = await db.service.findFirst({ where: { id, active: true } });
    if (!service) return { error: "Treatment not found." };
    const line = await db.basketItem.findFirst({ where: { basketId: basket.id, serviceId: id } });
    if (line) await db.basketItem.updateMany({ where: { id: line.id }, data: { quantity: { increment: qty } } });
    else
      await db.basketItem.create({
        data: { basketId: basket.id, itemType: "SERVICE", serviceId: id, quantity: qty, unitPriceCents: service.priceCents },
      });
  }

  revalidateClient(slug);
  return { ok: true as const };
}

export async function clientCartAction() {
  const { db, user } = await requireCustomerContext();
  const basket = await db.basket.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: "OPEN" },
    include: { items: { include: { service: true, product: true } } },
  });

  const items = (basket?.items ?? []).map((i) => ({
    id: i.id,
    name: i.service?.name ?? i.product?.name ?? "Item",
    imageUrl: i.service?.imageUrl ?? (Array.isArray(i.product?.images) ? ((i.product!.images as string[])[0] ?? null) : null),
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
  }));

  return { count: items.reduce((s, i) => s + i.quantity, 0), items };
}

export async function clientSetCartQtyAction(
  slug: string,
  itemId: string,
  qty: number,
): Promise<{ error: string } | { ok: true }> {
  const { db, user } = await requireCustomerContext();
  const line = await db.basketItem.findFirst({
    where: { id: itemId, basket: { customerProfileId: user.customerProfileId!, status: "OPEN" } },
  });
  // The cart may have been checked out in another tab since this sheet rendered.
  if (!line) return { error: "That item is no longer in your cart." };
  if (qty <= 0) await db.basketItem.deleteMany({ where: { id: itemId } });
  else await db.basketItem.updateMany({ where: { id: itemId }, data: { quantity: qty } });
  revalidateClient(slug);
  return { ok: true };
}

/** Rewards the client can afford that reduce an order total. */
export async function clientRedeemableRewardsAction() {
  const { db, user } = await requireCustomerContext();
  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
  const balance = profile?.loyaltyPointsBalance ?? 0;

  const rewards = await db.loyaltyReward.findMany({
    where: { active: true, rewardType: { in: ["DISCOUNT_AMOUNT", "DISCOUNT_PERCENT"] } },
    orderBy: { pointsCost: "asc" },
  });

  return rewards
    .filter((r) => r.pointsCost <= balance)
    .map((r) => ({
      id: r.id,
      name: r.name,
      pointsCost: r.pointsCost,
      discountAmountCents: r.discountAmountCents,
      discountPercent: r.discountPercent,
    }));
}

export async function clientCheckoutAction(
  slug: string,
  rewardId: string | null,
  simulateFailure = false,
): Promise<{ error: string } | { ok: true; orderNumber: string; pointsEarned: number; totalCents: number }> {
  const { db, user } = await requireCustomerContext();

  const basket = await db.basket.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: "OPEN" },
    include: { items: { include: { service: true, product: true } } },
  });
  const items = basket?.items ?? [];
  if (!basket || items.length === 0) return { error: "Your cart is empty." };

  for (const i of items) {
    if (i.itemType === "PRODUCT" && i.product && i.product.inventoryQuantity < i.quantity) {
      return { error: `${i.product.name} is out of stock.` };
    }
  }

  const subtotalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  let loyaltyDiscountCents = 0;
  let pointsRedeemed = 0;
  if (rewardId) {
    const reward = await db.loyaltyReward.findFirst({ where: { id: rewardId, active: true } });
    const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
    if (!reward) return { error: "That reward is no longer available." };
    if ((profile?.loyaltyPointsBalance ?? 0) < reward.pointsCost) return { error: "Not enough points for that reward." };
    pointsRedeemed = reward.pointsCost;
    loyaltyDiscountCents = rewardDiscountCents(reward, subtotalCents);
  }

  const settings = await db.tenantSettings.findFirst({ where: {} });
  const taxRate = settings?.taxRateBasisPoints ?? 0;
  const taxable = Math.max(subtotalCents - loyaltyDiscountCents, 0);
  const taxCents = Math.round((taxable * taxRate) / 10000);
  const totalCents = Math.max(subtotalCents - loyaltyDiscountCents + taxCents, 0);

  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;

  const currency = await tenantCurrency(db);
  const provider = getPaymentProvider();

  const order = await db.order.create({
    data: {
      customerProfileId: user.customerProfileId!,
      orderNumber,
      currency,
      status: "PENDING",
      subtotalCents,
      discountCents: 0,
      loyaltyDiscountCents,
      loyaltyPointsRedeemed: pointsRedeemed,
      taxCents,
      creditAppliedCents: 0,
      totalCents,
      items: {
        create: items.map((i) => ({
          itemType: i.itemType,
          serviceId: i.serviceId,
          productId: i.productId,
          name: i.service?.name ?? i.product?.name ?? "Item",
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.unitPriceCents * i.quantity,
          taxCents: 0,
        })),
      },
    } as never,
    include: { items: true },
  });

  // Reserve points and stock before charging. Each is an atomic conditional
  // update, so two clients cannot both take the last item and two checkouts
  // cannot spend the same points. Anything reserved is released if a later
  // step fails, so a failed checkout leaves balances and stock unchanged.
  const reserved = { points: 0, stock: [] as { productId: string; quantity: number }[] };
  const release = async () => {
    for (const r of reserved.stock) {
      await db.product.updateMany({ where: { id: r.productId }, data: { inventoryQuantity: { increment: r.quantity } } });
    }
    if (reserved.points > 0) {
      await adjustLoyaltyPoints(db, {
        customerProfileId: user.customerProfileId!,
        points: reserved.points,
        type: "REFUNDED",
        reason: `Order ${orderNumber} did not complete`,
        relatedOrderId: order.id,
      });
    }
  };
  const abandon = async (message: string) => {
    await release();
    await db.order.updateMany({ where: { id: order.id }, data: { status: "FAILED" } });
    return { error: message };
  };

  if (pointsRedeemed > 0) {
    try {
      await adjustLoyaltyPoints(db, {
        customerProfileId: user.customerProfileId!,
        points: -pointsRedeemed,
        type: "REDEEMED",
        reason: `Redeemed on order ${orderNumber}`,
        relatedOrderId: order.id,
        relatedRewardId: rewardId ?? undefined,
      });
      reserved.points = pointsRedeemed;
    } catch (err) {
      if (err instanceof InsufficientPointsError) return abandon("Not enough points for that reward.");
      throw err;
    }
  }
  for (const i of items) {
    if (i.itemType !== "PRODUCT" || !i.productId) continue;
    const taken = await db.product.updateMany({
      where: { id: i.productId, inventoryQuantity: { gte: i.quantity } },
      data: { inventoryQuantity: { decrement: i.quantity } },
    });
    if (taken.count === 0) return abandon(`${i.product?.name ?? "An item"} just sold out.`);
    reserved.stock.push({ productId: i.productId, quantity: i.quantity });
  }

  const intent = await provider.createIntent({
    amountCents: totalCents,
    currency,
    customerRef: user.customerProfileId!,
    description: `Order ${orderNumber}`,
    simulateFailure,
  });

  await db.payment.create({
    data: {
      orderId: order.id,
      provider: provider.name,
      providerPaymentId: intent.providerPaymentId,
      amountCents: totalCents,
      currency,
      status: intent.status,
      failureReason: intent.failureReason,
    } as never,
  });

  if (intent.status !== "SUCCEEDED") {
    // Basket intentionally stays OPEN so the client can retry.
    return abandon(intent.failureReason ?? "Payment failed. Please try another method.");
  }

  await db.order.updateMany({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });

  // Stock was already taken above; record the movements now the sale stands.
  for (const i of items) {
    if (i.itemType === "PRODUCT" && i.productId) {
      await db.inventoryTransaction.create({
        data: { productId: i.productId, type: "SALE", quantityChange: -i.quantity, reason: `Order ${orderNumber}` } as never,
      });
    }
  }

  const programme = await db.loyaltyProgramme.findFirst({ where: {} });
  let pointsEarned = 0;
  if (programme?.active) {
    pointsEarned = Math.floor(totalCents * programme.pointsPerCents);
    if (pointsEarned > 0) {
      await adjustLoyaltyPoints(db, {
        customerProfileId: user.customerProfileId!,
        points: pointsEarned,
        type: "EARNED",
        reason: "Earned from purchase",
        relatedOrderId: order.id,
        expiresAt: programme.pointsExpiryDays ? new Date(Date.now() + programme.pointsExpiryDays * 86_400_000) : null,
      });
    }
  }

  await db.basket.updateMany({ where: { id: basket.id }, data: { status: "CONVERTED" } });

  revalidateClient(slug);
  return { ok: true, orderNumber, pointsEarned, totalCents };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export async function clientRedeemRewardAction(
  slug: string,
  rewardId: string,
): Promise<{ error: string } | { ok: true; code: string; name: string }> {
  const { db, user } = await requireCustomerContext();

  const reward = await db.loyaltyReward.findFirst({ where: { id: rewardId, active: true } });
  if (!reward) return { error: "That reward is no longer available." };

  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
  if ((profile?.loyaltyPointsBalance ?? 0) < reward.pointsCost) {
    return { error: `You need ${reward.pointsCost - (profile?.loyaltyPointsBalance ?? 0)} more points.` };
  }

  try {
    await adjustLoyaltyPoints(db, {
      customerProfileId: user.customerProfileId!,
      points: -reward.pointsCost,
      type: "REDEEMED",
      reason: `Redeemed reward: ${reward.name}`,
      relatedRewardId: reward.id,
    });
  } catch (err) {
    // Another redemption spent the points between the check above and now.
    if (err instanceof InsufficientPointsError) return { error: "You don't have enough points for this reward any more." };
    throw err;
  }

  const code = `RW-${nanoid(6).toUpperCase()}`;

  await db.notification.create({
    data: {
      customerProfileId: user.customerProfileId!,
      title: "Reward redeemed",
      body: `${reward.name} — show code ${code} at the clinic.`,
      type: "LOYALTY",
    } as never,
  });

  revalidateClient(slug);
  return { ok: true, code, name: reward.name };
}

/**
 * Clinic check-in from the Scan tab. Guarded to once per day so a client
 * cannot farm visit points by re-scanning.
 */
export async function clientCheckInAction(slug: string): Promise<{ error: string } | { ok: true; points: number }> {
  const { db, user } = await requireCustomerContext();

  const programme = await db.loyaltyProgramme.findFirst({ where: {} });
  const award = programme?.pointsPerVisit ?? 0;

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const already = await db.loyaltyTransaction.findFirst({
    where: { customerProfileId: user.customerProfileId!, reason: "Clinic check-in", createdAt: { gte: since } },
  });
  if (already) return { error: "You've already checked in today." };

  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
  await db.customerProfile.updateMany({
    where: { id: user.customerProfileId! },
    data: { visitCount: (profile?.visitCount ?? 0) + 1, lastVisitAt: new Date() },
  });

  if (award > 0) {
    await adjustLoyaltyPoints(db, {
      customerProfileId: user.customerProfileId!,
      points: award,
      type: "EARNED",
      reason: "Clinic check-in",
    });
  }

  revalidateClient(slug);
  return { ok: true, points: award };
}

/**
 * Google review — awarded once per client when they open the clinic's review
 * page from the app. A review can't be verified from here, so this rewards
 * the visit, once, like the referral bonus below.
 */
export async function clientReviewAction(slug: string): Promise<{ error: string } | { ok: true; points: number }> {
  const { db, user } = await requireCustomerContext();

  const [programme, settings] = await Promise.all([
    db.loyaltyProgramme.findFirst({ where: {} }),
    db.tenantSettings.findFirst({ where: {}, select: { googleReviewUrl: true } }),
  ]);
  const award = programme?.active && settings?.googleReviewUrl ? programme.reviewPoints : 0;
  if (award <= 0) return { error: "Reviews aren't rewarded at this clinic." };

  const already = await db.loyaltyTransaction.findFirst({
    where: { customerProfileId: user.customerProfileId!, reason: "Google review" },
  });
  if (already) return { error: "You've already claimed your review bonus. Thank you!" };

  await adjustLoyaltyPoints(db, { customerProfileId: user.customerProfileId!, points: award, type: "EARNED", reason: "Google review" });

  revalidateClient(slug);
  return { ok: true, points: award };
}

/** Referral share — awarded once, tracked through the loyalty ledger. */
export async function clientReferralAction(slug: string): Promise<{ error: string } | { ok: true; points: number }> {
  const { db, user } = await requireCustomerContext();

  const programme = await db.loyaltyProgramme.findFirst({ where: {} });
  const award = programme?.referralPoints ?? 0;
  if (award <= 0) return { error: "Referrals aren't set up at this clinic yet." };

  const already = await db.loyaltyTransaction.findFirst({
    where: { customerProfileId: user.customerProfileId!, reason: "Referral shared" },
  });
  if (already) return { error: "You've already claimed your referral bonus." };

  await adjustLoyaltyPoints(db, {
    customerProfileId: user.customerProfileId!,
    points: award,
    type: "EARNED",
    reason: "Referral shared",
  });

  revalidateClient(slug);
  return { ok: true, points: award };
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function clientJoinPlanAction(slug: string, planId: string): Promise<{ error: string } | { ok: true; name: string }> {
  const { db, user } = await requireCustomerContext();

  const plan = await db.membershipPlan.findFirst({ where: { id: planId, active: true } });
  if (!plan) return { error: "That plan is no longer available." };

  const existing = await db.customerMembership.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] } },
  });
  if (existing) return { error: "You already have an active membership." };

  const sub = await getPaymentProvider().createSubscription({
    customerRef: user.customerProfileId!,
    planRef: plan.name,
    amountCents: plan.priceCents,
    currency: await tenantCurrency(db),
    intervalMonths: plan.billingFrequency === "MONTHLY" ? 1 : 12,
  });

  const now = new Date();
  const end = new Date(now);
  if (plan.billingFrequency === "MONTHLY") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);

  const membership = await db.customerMembership.create({
    data: {
      customerProfileId: user.customerProfileId!,
      membershipPlanId: plan.id,
      status: "ACTIVE",
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: end,
      nextBillingAt: end,
      creditBalanceCents: plan.includedCreditCents,
      stripeSubscriptionId: sub.providerSubscriptionId,
    } as never,
  });

  await db.membershipBillingEvent.create({
    data: {
      customerMembershipId: membership.id,
      type: "CHARGE",
      amountCents: plan.priceCents,
      description: `${plan.name} — first period`,
      occurredAt: now,
    } as never,
  });

  revalidateClient(slug);
  return { ok: true, name: plan.name };
}

export async function clientCancelPlanAction(slug: string): Promise<{ error: string } | { ok: true }> {
  const { db, user } = await requireCustomerContext();

  const membership = await db.customerMembership.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] } },
  });
  if (!membership) return { error: "You don't have an active membership." };

  if (membership.stripeSubscriptionId) {
    await getPaymentProvider().cancelSubscription(membership.stripeSubscriptionId);
  }

  await db.customerMembership.updateMany({
    where: { id: membership.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await db.membershipBillingEvent.create({
    data: { customerMembershipId: membership.id, type: "STATUS_CHANGE", description: "Cancelled by client" } as never,
  });

  revalidateClient(slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Profile & account
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
});

export async function clientSaveProfileAction(
  slug: string,
  input: { firstName: string; lastName?: string; phone?: string },
): Promise<{ error: string } | { ok: true }> {
  const { db, user } = await requireCustomerContext();

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await db.customerProfile.updateMany({
    where: { id: user.customerProfileId! },
    data: { firstName: parsed.data.firstName, lastName: parsed.data.lastName ?? "", phone: parsed.data.phone || null },
  });

  revalidateClient(slug);
  return { ok: true };
}

export async function clientSaveConsentAction(
  slug: string,
  consent: { emailConsent: boolean; smsConsent: boolean; pushConsent: boolean; marketingConsent: boolean },
): Promise<{ ok: true }> {
  const { db, user } = await requireCustomerContext();
  await db.customerProfile.updateMany({ where: { id: user.customerProfileId! }, data: consent });
  revalidateClient(slug);
  return { ok: true };
}

/**
 * Client-initiated account closure. Deactivates the login and clears
 * marketing consent rather than hard-deleting, so the clinic keeps the
 * financial and clinical history it is legally required to retain. The
 * deletion request itself is recorded in the audit log.
 */
export async function clientDeleteAccountAction(slug: string): Promise<{ ok: true }> {
  const { db, user } = await requireCustomerContext();

  await db.customerProfile.updateMany({
    where: { id: user.customerProfileId! },
    data: { marketingConsent: false, emailConsent: false, smsConsent: false, pushConsent: false },
  });
  // Disabled accounts are refused on every request; sessionsValidAfter keeps
  // sessions from before the closure dead even if the account is reopened.
  await rawDb.user.update({ where: { id: user.id }, data: { status: "DISABLED", sessionsValidAfter: new Date() } });

  await writeAuditLog({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorType: "SYSTEM",
    action: "client.account_deletion_requested",
    entityType: "CustomerProfile",
    entityId: user.customerProfileId ?? undefined,
    reason: "Requested by client from the patient app",
  });

  revalidateClient(slug);
  return { ok: true };
}
