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
