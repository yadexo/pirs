import "server-only";
import { rawDb } from "@/lib/db";
import { notifyClientQuietly } from "@/lib/web-push";

/**
 * The notifications the app sends by itself, off the back of something that
 * already happened. Each one is addressed to a client through their order, so
 * the only thing a caller has to know is which order it is.
 *
 * Nothing here can throw: these are called from the Stripe webhook, where an
 * exception would have Stripe retry an event that has already been applied.
 */

interface OrderRecipient {
  userId: string;
  clinicName: string;
  slug: string;
  orderNumber: string;
  currency: string;
}

/** Who to tell about an order, and how to address them. Null when unreachable. */
async function recipientForOrder(orderId: string): Promise<OrderRecipient | null> {
  const order = await rawDb.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      currency: true,
      customerProfile: { select: { userId: true } },
      tenant: { select: { name: true, slug: true, branding: { select: { businessName: true } } } },
    },
  });
  if (!order?.customerProfile?.userId) return null;
  return {
    userId: order.customerProfile.userId,
    clinicName: order.tenant.branding?.businessName ?? order.tenant.name,
    slug: order.tenant.slug,
    orderNumber: order.orderNumber,
    currency: order.currency,
  };
}

/**
 * The path back into the clinic's own app — never another clinic's, and
 * always inside the installed app's scope so opening it doesn't bounce the
 * client into Safari.
 *
 * There is no request to read a host from here (the webhook is Stripe's
 * request, not the client's), so this follows the same rule as the links the
 * app prints: the short address when the client app has its own domain.
 */
function clinicPath(slug: string, rest = ""): string {
  const short = Boolean(process.env.CLIENT_APP_URL);
  return `${short ? "" : "/app"}/${encodeURIComponent(slug)}${rest}`;
}

/** Same wording as the app: whole amounts without decimals. */
function amount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** An order the client paid for has been settled by Stripe. */
export async function notifyOrderPaid(orderId: string, amountCents: number): Promise<void> {
  const to = await recipientForOrder(orderId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `Payment received for ${to.orderNumber} — ${amount(amountCents, to.currency)}. Thank you!`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `order-paid-${orderId}`,
  });
}

/** One of the client's items has just been collected at the clinic. */
export async function notifyItemRedeemed(customerUserId: string, clinicName: string, slug: string, itemName: string): Promise<void> {
  await notifyClientQuietly(customerUserId, {
    title: clinicName,
    body: `${itemName} has been redeemed. Enjoy!`,
    url: clinicPath(slug, "/profile?tab=items"),
    icon: clinicPath(slug, "/app-icon/192.png"),
  });
}

/** Money is on its way back to the client. */
export async function notifyRefundProcessed(orderId: string, amountCents: number, fully: boolean): Promise<void> {
  const to = await recipientForOrder(orderId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${fully ? "Refunded" : "Partly refunded"}: ${amount(amountCents, to.currency)} for ${to.orderNumber}. It can take a few days to reach your bank.`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `order-refund-${orderId}`,
  });
}

/** Who to tell about their own balance, and how to address them. */
async function recipientForClient(customerProfileId: string) {
  const profile = await rawDb.customerProfile.findUnique({
    where: { id: customerProfileId },
    select: {
      userId: true,
      tenant: { select: { name: true, slug: true, branding: { select: { businessName: true, currency: true } } } },
    },
  });
  if (!profile?.userId) return null;
  return {
    userId: profile.userId,
    clinicName: profile.tenant.branding?.businessName ?? profile.tenant.name,
    slug: profile.tenant.slug,
    currency: profile.tenant.branding?.currency ?? "EUR",
  };
}

/**
 * A staff member changed this client's credit.
 *
 * A service notification, not marketing: it is about money the client holds
 * at the clinic, so it goes to them whatever they have said about offers.
 * The reason the staff member gave is included, because "your balance
 * changed" with no explanation is worse than saying nothing.
 */
export async function notifyCreditChanged(customerProfileId: string, amountCents: number, reason: string): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  const added = amountCents > 0;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${added ? "Credit added" : "Credit removed"}: ${amount(Math.abs(amountCents), to.currency)} — ${reason}`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `credit-${customerProfileId}-${Date.now()}`,
  });
}

/**
 * A staff member changed this client's loyalty points.
 *
 * Points are worth money to the client, so this is a service notification
 * too: it goes to them whatever they have said about offers.
 */
export async function notifyPointsChanged(customerProfileId: string, points: number, reason: string): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  const added = points > 0;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${added ? "Points added" : "Points removed"}: ${Math.abs(points)} — ${reason}`,
    url: clinicPath(to.slug, "/rewards"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `points-${customerProfileId}-${Date.now()}`,
  });
}

/** Who to tell about a membership, and how to address them. */
async function recipientForMembership(membershipId: string) {
  const membership = await rawDb.customerMembership.findUnique({
    where: { id: membershipId },
    select: {
      customerProfile: { select: { userId: true } },
      membershipPlan: { select: { name: true } },
      tenant: { select: { name: true, slug: true, branding: { select: { businessName: true } } } },
    },
  });
  if (!membership?.customerProfile?.userId) return null;
  return {
    userId: membership.customerProfile.userId,
    clinicName: membership.tenant.branding?.businessName ?? membership.tenant.name,
    slug: membership.tenant.slug,
    planName: membership.membershipPlan?.name ?? "Membership",
  };
}

/**
 * A membership payment failed. Said plainly, with what to do and by when —
 * a card that merely expired should not cost somebody their benefits because
 * nobody told them.
 */
export async function notifyMembershipPaymentFailed(membershipId: string, benefitsEndAt?: Date | null): Promise<void> {
  const to = await recipientForMembership(membershipId);
  if (!to) return;
  const deadline = benefitsEndAt
    ? ` Your benefits continue until ${benefitsEndAt.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`
    : "";
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `We couldn't take the payment for your ${to.planName}. Update your card to keep it.${deadline}`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `membership-failed-${membershipId}`,
  });
}

/**
 * A staff member changed this client's membership.
 *
 * `what` is already a sentence addressed to the client, because what they
 * need to know differs with the change: ending, pausing, moving plan and
 * being given free time are not variations of one message.
 */
export async function notifyMembershipChanged(membershipId: string, what: string, reason: string): Promise<void> {
  const to = await recipientForMembership(membershipId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${what} — ${reason}`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `membership-changed-${membershipId}-${Date.now()}`,
  });
}

/** The grace period ran out and the membership has stopped. */
export async function notifyMembershipSuspended(membershipId: string): Promise<void> {
  const to = await recipientForMembership(membershipId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `Your ${to.planName} is on hold because the payment didn't go through. It restarts as soon as a payment succeeds.`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `membership-suspended-${membershipId}`,
  });
}

/** A membership period has been paid for and the plan is live. */
export async function notifyMembershipActive(membershipId: string): Promise<void> {
  const to = await recipientForMembership(membershipId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `Your ${to.planName} is active. Enjoy your benefits!`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `membership-active-${membershipId}`,
  });
}
