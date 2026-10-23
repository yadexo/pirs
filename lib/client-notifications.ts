import "server-only";
import { rawDb } from "@/lib/db";
import { notifyClientQuietly } from "@/lib/web-push";
import type { EmailBranding } from "@/lib/emails/layout";
import type { EmailTemplate } from "@/lib/emails/templates";
import { senderFor } from "@/lib/emails/sender";
import { formatDay } from "@/lib/client-format";

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
  email: string | null;
  firstName: string;
  clinicName: string;
  branding: EmailBranding;
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
      customerProfile: { select: { userId: true, firstName: true, user: { select: { email: true } } } },
      tenant: {
        select: { name: true, slug: true, branding: { select: { businessName: true, logoUrl: true, primaryColor: true } } },
      },
    },
  });
  if (!order?.customerProfile?.userId) return null;
  const clinicName = order.tenant.branding?.businessName ?? order.tenant.name;
  return {
    userId: order.customerProfile.userId,
    email: order.customerProfile.user?.email ?? null,
    firstName: order.customerProfile.firstName,
    clinicName,
    branding: { name: clinicName, logoUrl: order.tenant.branding?.logoUrl ?? null, color: order.tenant.branding?.primaryColor ?? null },
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

/**
 * The same path as a link somebody can click in an email, where a path on its
 * own means nothing.
 */
function absoluteClientUrl(path: string): string {
  const base = (process.env.CLIENT_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

/**
 * An email the client can keep, for the things a push is too small to carry.
 *
 * Quiet like its push counterpart: these are sent from actions that have
 * already changed something, and a mail server having a bad afternoon must
 * not undo it. Without an email provider configured this does nothing, which
 * is the mock provider's job to report in development.
 */
/**
 * Sends a fully-built, branded template. Service mail about the client's own
 * order, account or money, so emailConsent (which is about marketing offers)
 * is deliberately not consulted here — the same rule the push side follows.
 * Never throws: called from the Stripe webhook and from cron, where an
 * exception would have the event retried after it has already been applied.
 */
async function sendBrandedEmail(to: string | null, clinicName: string, template: EmailTemplate): Promise<void> {
  if (!to) return;
  try {
    const { getEmailProvider } = await import("@/lib/providers/notifications");
    const result = await getEmailProvider().send({ to, subject: template.subject, body: template.text, html: template.html, from: senderFor(clinicName) });
    if (result.status === "FAILED") console.error(`[client-notifications] email to ${to} failed:`, result.error);
  } catch (err) {
    console.error(`[client-notifications] email to ${to} not sent:`, err instanceof Error ? err.message : err);
  }
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

/**
 * The receipt email: every order, however it was paid for — card, iDEAL,
 * credit alone — gets one. Called from completePaidOrder itself
 * (lib/order-completion.ts), the one place every payment path settles
 * through, so this never depends on which of them fired.
 */
export async function notifyOrderConfirmation(orderId: string): Promise<void> {
  const [to, order] = await Promise.all([
    recipientForOrder(orderId),
    rawDb.order.findUnique({
      where: { id: orderId },
      select: { totalCents: true, taxCents: true, items: { select: { name: true, quantity: true, totalCents: true } } },
    }),
  ]);
  if (!to || !order) return;
  const { orderReceiptEmail } = await import("@/lib/emails/templates");
  const template = orderReceiptEmail({
    branding: to.branding,
    firstName: to.firstName,
    orderNumber: to.orderNumber,
    lines: order.items,
    totalCents: order.totalCents,
    vatCents: order.taxCents,
    currency: to.currency,
    myItemsUrl: absoluteClientUrl(clinicPath(to.slug, "/profile?tab=items")),
  });
  await sendBrandedEmail(to.email, to.clinicName, template);
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

  const { refundConfirmationEmail } = await import("@/lib/emails/templates");
  await sendBrandedEmail(
    to.email,
    to.clinicName,
    refundConfirmationEmail({ branding: to.branding, firstName: to.firstName, orderNumber: to.orderNumber, amountCents, currency: to.currency, fully }),
  );
}

/** Who to tell about their own balance, and how to address them. */
async function recipientForClient(customerProfileId: string) {
  const profile = await rawDb.customerProfile.findUnique({
    where: { id: customerProfileId },
    select: {
      userId: true,
      firstName: true,
      user: { select: { email: true } },
      tenant: {
        select: { name: true, slug: true, branding: { select: { businessName: true, currency: true, logoUrl: true, primaryColor: true } } },
      },
    },
  });
  if (!profile?.userId) return null;
  const clinicName = profile.tenant.branding?.businessName ?? profile.tenant.name;
  return {
    userId: profile.userId,
    email: profile.user?.email ?? null,
    firstName: profile.firstName,
    clinicName,
    branding: { name: clinicName, logoUrl: profile.tenant.branding?.logoUrl ?? null, color: profile.tenant.branding?.primaryColor ?? null } as EmailBranding,
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

/**
 * A staff member gave this client something, or replaced a code.
 *
 * `headline` differs because the two are not the same news: a gift is a
 * surprise, a replacement is the answer to a problem they already had.
 */
export async function notifyItemIssued(customerProfileId: string, itemName: string, headline: string, reason: string): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${headline}: ${itemName} — ${reason}`,
    url: clinicPath(to.slug, "/profile?tab=items"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `item-issued-${customerProfileId}-${Date.now()}`,
  });
}

/**
 * An item the client had is no longer theirs to collect. Told plainly and
 * with the reason, because they can see it change in their own app.
 */
export async function notifyItemVoided(customerProfileId: string, itemName: string, reason: string): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${itemName} is no longer available — ${reason}`,
    url: clinicPath(to.slug, "/profile?tab=items"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `item-voided-${customerProfileId}-${Date.now()}`,
  });
}

/**
 * A member's price is going up.
 *
 * Both channels, because this one costs them money: a push they may miss and
 * an email they can keep. It says the new price, the date it first applies,
 * and that they can leave before then — with the link to do it, since telling
 * somebody they may cancel while making them hunt for the button is not
 * really telling them.
 */
export async function notifyPriceChange(
  customerProfileId: string,
  change: { planName: string; newPriceCents: number; currency: string; effectiveAt: Date },
): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;

  const when = formatDay(change.effectiveAt, null);
  const price = amount(change.newPriceCents, change.currency);
  const manage = clinicPath(to.slug, "/profile?tab=membership");
  const line = `${change.planName} becomes ${price} from ${when}. You can cancel any time before then.`;

  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: line,
    url: manage,
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `price-change-${customerProfileId}-${change.effectiveAt.getTime()}`,
  });

  const { membershipPriceChangeEmail } = await import("@/lib/emails/templates");
  await sendBrandedEmail(
    to.email,
    to.clinicName,
    membershipPriceChangeEmail({
      branding: to.branding,
      firstName: to.firstName,
      planName: change.planName,
      newPriceCents: change.newPriceCents,
      currency: change.currency,
      effectiveDate: when,
      manageUrl: absoluteClientUrl(manage),
    }),
  );
}

/** Who to tell about a membership, and how to address them. */
async function recipientForMembership(membershipId: string) {
  const membership = await rawDb.customerMembership.findUnique({
    where: { id: membershipId },
    select: {
      customerProfile: { select: { userId: true, firstName: true, user: { select: { email: true } } } },
      membershipPlan: { select: { name: true } },
      tenant: {
        select: { name: true, slug: true, branding: { select: { businessName: true, logoUrl: true, primaryColor: true } } },
      },
    },
  });
  if (!membership?.customerProfile?.userId) return null;
  const clinicName = membership.tenant.branding?.businessName ?? membership.tenant.name;
  return {
    userId: membership.customerProfile.userId,
    email: membership.customerProfile.user?.email ?? null,
    firstName: membership.customerProfile.firstName,
    clinicName,
    branding: { name: clinicName, logoUrl: membership.tenant.branding?.logoUrl ?? null, color: membership.tenant.branding?.primaryColor ?? null } as EmailBranding,
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
  const endDay = benefitsEndAt ? formatDay(benefitsEndAt, null) : null;
  const deadline = endDay ? ` Your benefits continue until ${endDay}.` : "";
  const updateUrl = clinicPath(to.slug, "/profile?tab=membership");
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `We couldn't take the payment for your ${to.planName}. Update your card to keep it.${deadline}`,
    url: updateUrl,
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `membership-failed-${membershipId}`,
  });

  const { membershipPaymentFailedEmail } = await import("@/lib/emails/templates");
  await sendBrandedEmail(
    to.email,
    to.clinicName,
    membershipPaymentFailedEmail({
      branding: to.branding,
      firstName: to.firstName,
      planName: to.planName,
      updatePaymentUrl: absoluteClientUrl(updateUrl),
      benefitsEndAt: endDay,
    }),
  );
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
export async function notifyMembershipActive(membershipId: string, paidCents?: number, currency?: string): Promise<void> {
  const to = await recipientForMembership(membershipId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `Your ${to.planName} is active. Enjoy your benefits!`,
    url: clinicPath(to.slug, "/profile?tab=settings"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `membership-active-${membershipId}`,
  });

  // The amount is only known when this came from a real invoice payment
  // (the webhook); other callers — reactivation with nothing charged, say —
  // have nothing to confirm, so no "payment received" email goes out.
  if (paidCents !== undefined && paidCents > 0 && currency) {
    const { membershipPaymentReceivedEmail } = await import("@/lib/emails/templates");
    await sendBrandedEmail(
      to.email,
      to.clinicName,
      membershipPaymentReceivedEmail({ branding: to.branding, firstName: to.firstName, planName: to.planName, amountCents: paidCents, currency }),
    );
  }
}

/**
 * Somebody gave this client sessions from a package they bought.
 *
 * A service notification, not an offer: the client now owns something, and
 * the sessions have an end date they need to know about.
 */
export async function notifySessionsReceived(customerProfileId: string, packageName: string, sessions: number): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `You've been given ${sessions} ${packageName} session${sessions === 1 ? "" : "s"}. They're in My items.`,
    url: clinicPath(to.slug, "/profile"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `sessions-${customerProfileId}-${Date.now()}`,
  });
}

/**
 * Sessions the client still has are about to run out.
 *
 * Sent once, a fortnight before the end date, and only while there is
 * something left to use — see lib/package-pricing.ts.
 */
export async function notifySessionsExpiring(customerProfileId: string, packageName: string, sessions: number, endsOn: string): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  const myItems = clinicPath(to.slug, "/profile");
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${sessions} ${packageName} session${sessions === 1 ? "" : "s"} left — they run out on ${endsOn}.`,
    url: myItems,
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `sessions-expiring-${customerProfileId}`,
  });

  const { sessionsExpiringEmail } = await import("@/lib/emails/templates");
  await sendBrandedEmail(
    to.email,
    to.clinicName,
    sessionsExpiringEmail({ branding: to.branding, firstName: to.firstName, packageName, sessions, endsOn, myItemsUrl: absoluteClientUrl(myItems) }),
  );
}

/**
 * A session of a package was used at the desk.
 *
 * A service notification: the client's own balance of sessions just went
 * down, and the count is the point of the message.
 */
export async function notifySessionUsed(customerProfileId: string, packageName: string, serviceName: string, remaining: number): Promise<void> {
  const to = await recipientForClient(customerProfileId);
  if (!to) return;
  await notifyClientQuietly(to.userId, {
    title: to.clinicName,
    body: `${packageName}: 1 session used for ${serviceName}, ${remaining} left`,
    url: clinicPath(to.slug, "/profile"),
    icon: clinicPath(to.slug, "/app-icon/192.png"),
    tag: `session-used-${customerProfileId}-${Date.now()}`,
  });
}
