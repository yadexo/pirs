import { describe, it, expect, vi, beforeEach } from "vitest";
import webpush, { WebPushError } from "web-push";

const deleteMany = vi.fn(async () => ({ count: 0 }));
const updateMany = vi.fn(async () => ({ count: 0 }));
vi.mock("@/lib/db", () => ({ rawDb: { pushSubscription: { deleteMany, updateMany } } }));

const { deliver, vapidConfigured } = await import("@/lib/web-push");
type Sender = Parameters<typeof deliver>[2];

/** A sender that always succeeds, typed so its calls can be inspected. */
const accepting = (): Sender => vi.fn(async () => ({}) as never);

/** A stored row, as the database hands it over. */
const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "key", auth: "auth" });

/** Web Push's own error shape for a dead or unhappy endpoint. */
const httpError = (status: number) => new WebPushError("gone", status, {}, "", "https://push.example/x");

describe("web push delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Real keys, made for this run: web-push checks their shape, and a test
    // must never carry a private key of its own.
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  it("counts a send per device and marks them used", async () => {
    const send = vi.fn(async () => ({}) as never);
    const result = await deliver([sub("a"), sub("b")], { title: "Hi", body: "There" }, send);

    expect(result).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["a", "b"] } } }));
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("sends the message as the payload the service worker reads", async () => {
    const send = accepting() as ReturnType<typeof vi.fn>;
    await deliver([sub("a")], { title: "Riverside", body: "Paid", url: "/riverside/shop", tag: "t", icon: "/i.png" }, send);

    const [subscription, payload] = send.mock.calls[0] as [unknown, string];
    expect(subscription).toEqual({ endpoint: "https://push.example/a", keys: { p256dh: "key", auth: "auth" } });
    expect(JSON.parse(payload)).toEqual({ title: "Riverside", body: "Paid", url: "/riverside/shop", tag: "t", icon: "/i.png" });
  });

  it("deletes a subscription the push service says is gone, and keeps the rest", async () => {
    const send = vi.fn(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint.endsWith("dead")) throw httpError(410);
      if (subscription.endpoint.endsWith("missing")) throw httpError(404);
      return {} as never;
    });

    const result = await deliver([sub("alive"), sub("dead"), sub("missing")], { title: "Hi", body: "There" }, send);

    expect(result).toEqual({ sent: 1, removed: 2, failed: 0 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["dead", "missing"] } } });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["alive"] } } }));
  });

  it("keeps a subscription that failed for a reason that might pass next time", async () => {
    const send = vi.fn(async () => {
      throw httpError(500);
    });
    const result = await deliver([sub("a")], { title: "Hi", body: "There" }, send);

    expect(result).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing at all when there is no device to send to", async () => {
    const send = vi.fn();
    expect(await deliver([], { title: "Hi", body: "There" }, send)).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to send when the platform has no keys, rather than sending unsigned", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(vapidConfigured()).toBe(false);
    await expect(deliver([sub("a")], { title: "Hi", body: "There" }, vi.fn())).rejects.toThrow(/aren't set up/);
  });
});
