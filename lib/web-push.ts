import webpush, { type PushSubscription as WebPushSubscription, type SendResult, WebPushError } from "web-push";
import { rawDb } from "@/lib/db";

/**
 * Web Push for the clients' installed apps.
 *
 * Sending is best-effort by design: a notification is a courtesy on top of
 * something that already happened (an order was paid, a refund went through).
 * If a push service is down, or a phone has been wiped, the order is still
 * paid — so `notifyClientQuietly` swallows everything, and only the routes a
 * client triggers themselves report a failure back.
 *
 * Subscriptions are pruned as they die. A push service answers 404 or 410 for
 * an endpoint that no longer exists (app deleted, permission revoked), and
 * keeping those rows would mean retrying a dead device forever.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Path inside the clinic's app, e.g. "/riverside/shop". */
  url?: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
  icon?: string;
}

export interface PushOutcome {
  /** Devices the push service accepted the message for. */
  sent: number;
  /** Subscriptions deleted because the device is gone. */
  removed: number;
  /** Devices that failed for some other reason (service down, too large). */
  failed: number;
}

export function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

class VapidNotConfiguredError extends Error {
  constructor() {
    super("Push notifications aren't set up on this platform yet.");
  }
}

function configure() {
  if (!vapidConfigured()) throw new VapidNotConfiguredError();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The send call, as an argument so tests don't need a push service. */
export type Sender = (subscription: WebPushSubscription, payload: string) => Promise<SendResult>;

const realSender: Sender = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 24 });

/** HTTP statuses that mean "this device is gone", rather than "try again". */
function isGone(err: unknown): boolean {
  return err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
}

/**
 * Sends one message to a set of devices, deleting the ones that are gone.
 * Exported for the tests; callers use the two functions below.
 */
export async function deliver(subscriptions: StoredSubscription[], message: PushMessage, send: Sender = realSender): Promise<PushOutcome> {
  if (subscriptions.length === 0) return { sent: 0, removed: 0, failed: 0 };
  configure();

  const payload = JSON.stringify(message);
  const dead: string[] = [];
  const alive: string[] = [];
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
        alive.push(row.id);
      } catch (err) {
        if (isGone(err)) dead.push(row.id);
        else failed += 1;
      }
    }),
  );

  if (dead.length) await rawDb.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  if (alive.length) await rawDb.pushSubscription.updateMany({ where: { id: { in: alive } }, data: { lastUsedAt: new Date() } });

  return { sent: alive.length, removed: dead.length, failed };
}

const SELECT = { id: true, endpoint: true, p256dh: true, auth: true } as const;

/** Every device belonging to one client. */
export async function sendToClient(userId: string, message: PushMessage, send?: Sender): Promise<PushOutcome> {
  const subscriptions = await rawDb.pushSubscription.findMany({ where: { userId }, select: SELECT });
  return deliver(subscriptions, message, send);
}

/** Every device belonging to every client of one clinic. */
export async function sendToClinicClients(tenantId: string, message: PushMessage, send?: Sender): Promise<PushOutcome> {
  const subscriptions = await rawDb.pushSubscription.findMany({ where: { tenantId }, select: SELECT });
  return deliver(subscriptions, message, send);
}

/**
 * For callers that must not fail because a notification did: the Stripe
 * webhook above all, where an exception would make Stripe retry an event that
 * has already been applied.
 */
export async function notifyClientQuietly(userId: string, message: PushMessage): Promise<void> {
  if (!vapidConfigured()) return;
  try {
    await sendToClient(userId, message);
  } catch (err) {
    console.error(`[web-push] could not notify ${userId}:`, err instanceof Error ? err.message : err);
  }
}
