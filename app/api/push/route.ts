import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { notifyClientQuietly, sendToClient, vapidConfigured, vapidPublicKey } from "@/lib/web-push";

/**
 * The client app's own push endpoint: subscribe, unsubscribe, send yourself a
 * test. One route rather than three, because all three need the same thing —
 * the signed-in client — and differ only in a verb.
 *
 * A client can only ever act on their own subscriptions: the row is written
 * with the session's own user and tenant, never with anything the browser
 * sends, so there is nothing to forge.
 */

/**
 * Testing notifications means sending several in a row — on a locked phone,
 * then an unlocked one, then after reinstalling. An hour's wait between
 * batches made that painful, so the window is short and the burst small.
 */
const TESTS_PER_WINDOW = 5;
const TEST_WINDOW_MS = 2 * 60 * 1000;

const subscribe = z.object({
  action: z.literal("subscribe"),
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
const unsubscribe = z.object({ action: z.literal("unsubscribe"), endpoint: z.string().url().max(2000) });
const test = z.object({ action: z.literal("test") });
const body = z.discriminatedUnion("action", [subscribe, unsubscribe, test]);

/** Tells the browser which key to subscribe with, and whether it is worth asking. */
export async function GET() {
  const { user } = await requireCustomerContext();
  const devices = await rawDb.pushSubscription.count({ where: { userId: user.id } });
  return NextResponse.json({ configured: vapidConfigured(), publicKey: vapidPublicKey(), devices });
}

export async function POST(req: Request) {
  const { user } = await requireCustomerContext();
  if (!vapidConfigured()) {
    return NextResponse.json({ error: "Push notifications aren't set up on this platform yet." }, { status: 501 });
  }

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That request didn't make sense." }, { status: 400 });
  const input = parsed.data;

  if (input.action === "unsubscribe") {
    // Scoped to this client: one person cannot delete another's device.
    const { count } = await rawDb.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: input.endpoint } });
    return NextResponse.json({ ok: true, removed: count });
  }

  const test = input.action === "test";
  // The window is part of the key, so changing it starts a fresh count rather
  // than leaving anyone held by a bucket that an older, longer window opened.
  const key = test ? `push:test:${TEST_WINDOW_MS}:${user.id}` : `push:${input.action}:${user.id}`;
  const limit = await rateLimit(key, test ? TESTS_PER_WINDOW : 20, test ? TEST_WINDOW_MS : 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: test
          ? `That's ${TESTS_PER_WINDOW} tests in ${TEST_WINDOW_MS / 60000} minutes. Wait a couple of minutes and try again.`
          : "That's a lot of tries in one hour. Give it a minute.",
      },
      { status: 429 },
    );
  }

  if (input.action === "test") {
    const devices = await rawDb.pushSubscription.count({ where: { userId: user.id } });
    if (devices === 0) {
      return NextResponse.json({ error: "This device isn't subscribed. Turn notifications off and on again." }, { status: 409 });
    }

    // Sent before replying, so the answer reports what actually happened —
    // and so tapping the button feels like pressing a button. It used to
    // wait three seconds, for testing a locked phone, which made every
    // other kind of test feel broken.
    const result = await sendToClient(user.id, {
      title: "Notifications are on",
      body: "This is what a message from your clinic will look like.",
      tag: "test",
    });
    if (result.sent === 0) {
      return NextResponse.json({ error: "No device could be reached. Turn notifications off and on again." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, message: `Sent to ${result.sent} ${result.sent === 1 ? "device" : "devices"}.`, ...result });
  }

  // The endpoint identifies the device, so re-subscribing the same one moves
  // it to this account rather than leaving a second row pointing at it.
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  await rawDb.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      tenantId: user.tenantId!,
      userId: user.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
    },
    update: {
      tenantId: user.tenantId!,
      userId: user.id,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
      lastUsedAt: new Date(),
    },
  });

  // Turning notifications on means saying yes to what the app said it would
  // send: the order and appointment updates, and the clinic's offers. But a
  // client who has ever switched offers off themselves keeps that choice —
  // `marketingConsentChosenAt` is set only by their own decisions, so this
  // can never undo one, however many times they toggle notifications.
  await rawDb.customerProfile.updateMany({
    where: { id: user.customerProfileId!, marketingConsentChosenAt: null },
    data: {
      pushConsent: true,
      marketingConsent: true,
      marketingConsentChosenAt: new Date(),
      marketingConsentSource: "push-opt-in",
    },
  });
  // Push itself is on either way: it is what they just agreed to.
  await rawDb.customerProfile.updateMany({ where: { id: user.customerProfileId! }, data: { pushConsent: true } });

  // Confirms on the device itself that it works — and iOS wants the first
  // notification soon after permission is granted.
  await notifyClientQuietly(user.id, {
    title: "Notifications are on",
    body: "You'll hear from your clinic here.",
    tag: "welcome",
  });
  return NextResponse.json({ ok: true });
}
