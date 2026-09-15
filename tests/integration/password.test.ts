import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.1` }) }));
const sent = vi.hoisted(() => ({ calls: [] as { to: string; body: string }[] }));
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (p: { to: string; body: string }) => {
      sent.calls.push(p);
      return { providerMessageId: "t", status: "SENT" };
    },
  }),
}));

const { issuePasswordToken, inspectPasswordToken, consumePasswordToken, INVITE_TTL_MS } = await import("@/lib/password-tokens");
const { requestPasswordResetAction, setPasswordAction } = await import("@/lib/actions/password");
const { loadLiveAccount } = await import("@/lib/live-account");

describe("password tokens and sessions", () => {
  const stamp = Date.now();
  let tenantId: string;
  let slug: string;
  let staffId: string;
  let invitedId: string;
  let clientId: string;

  beforeAll(async () => {
    slug = `pw-${stamp}`;
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Password Clinic" } })).id;
    staffId = (await rawDb.user.create({ data: { tenantId, email: `staff-${stamp}@x.com`, passwordHash: await hashPassword("old-password"), role: "TENANT_ADMIN" } })).id;
    invitedId = (await rawDb.user.create({ data: { tenantId, email: `invited-${stamp}@x.com`, passwordHash: "!", role: "STAFF", status: "INVITED" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId, userId: invitedId, firstName: "New", lastName: "Hire" } });
    clientId = (await rawDb.user.create({ data: { tenantId, email: `client-${stamp}@x.com`, passwordHash: await hashPassword("client-pass"), role: "CUSTOMER" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  beforeEach(() => {
    sent.calls.length = 0;
  });

  it("stores only a hash of the token", async () => {
    const raw = await issuePasswordToken(staffId, 60_000);
    const rows = await rawDb.passwordResetToken.findMany({ where: { userId: staffId } });
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
  });

  it("sets the password once, and a used link stops working", async () => {
    const raw = await issuePasswordToken(staffId, 60_000);
    expect(await inspectPasswordToken(raw)).toMatchObject({ email: `staff-${stamp}@x.com`, isInvite: false });

    expect(await consumePasswordToken(raw, "brand-new-password")).toMatchObject({ ok: true });
    const user = await rawDb.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(await verifyPassword("brand-new-password", user.passwordHash)).toBe(true);

    expect(await consumePasswordToken(raw, "another-password")).toEqual({ ok: false, reason: "invalid" });
    expect(await inspectPasswordToken(raw)).toBeNull();
  });

  it("lets only one of two simultaneous submissions use a token", async () => {
    const raw = await issuePasswordToken(staffId, 60_000);
    const results = await Promise.all([consumePasswordToken(raw, "first-password-1"), consumePasswordToken(raw, "second-password-2")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses expired tokens, and a newer link retires older ones", async () => {
    const expired = await issuePasswordToken(staffId, -1000);
    expect(await consumePasswordToken(expired, "whatever-long")).toEqual({ ok: false, reason: "invalid" });

    const older = await issuePasswordToken(staffId, 60_000);
    const newer = await issuePasswordToken(staffId, 60_000);
    expect(await consumePasswordToken(older, "whatever-long")).toEqual({ ok: false, reason: "invalid" });
    expect(await consumePasswordToken(newer, "whatever-long")).toMatchObject({ ok: true });
  });

  it("rejects a too-short password without using the token", async () => {
    const raw = await issuePasswordToken(staffId, 60_000);
    expect(await consumePasswordToken(raw, "short")).toEqual({ ok: false, reason: "weak" });
    expect(await inspectPasswordToken(raw)).not.toBeNull();
  });

  it("activates an invited staff member", async () => {
    const raw = await issuePasswordToken(invitedId, INVITE_TTL_MS);
    expect(await inspectPasswordToken(raw)).toMatchObject({ isInvite: true });
    await consumePasswordToken(raw, "welcome-aboard-1");
    const user = await rawDb.user.findUniqueOrThrow({ where: { id: invitedId }, include: { staffProfile: true } });
    expect(user.status).toBe("ACTIVE");
    expect(user.staffProfile!.activatedAt).not.toBeNull();
  });

  it("ends every session that existed before the reset", async () => {
    const sessionStartedBefore = Date.now() - 5_000;
    expect(await loadLiveAccount(clientId, sessionStartedBefore)).not.toBeNull();

    const raw = await issuePasswordToken(clientId, 60_000);
    await consumePasswordToken(raw, "client-new-pass");

    expect(await loadLiveAccount(clientId, sessionStartedBefore)).toBeNull();
    // A session from before authTime existed is treated as old too.
    expect(await loadLiveAccount(clientId, undefined)).toBeNull();
    expect(await loadLiveAccount(clientId, Date.now() + 1)).not.toBeNull();
  });

  describe("forgot password form", () => {
    const ask = (email: string, clinic?: string) => {
      const fd = new FormData();
      fd.set("email", email);
      if (clinic) fd.set("clinic", clinic);
      return requestPasswordResetAction(undefined, fd);
    };

    it("answers identically for real and unknown addresses", async () => {
      const real = await ask(`staff-${stamp}@x.com`);
      const unknown = await ask(`nobody-${stamp}@x.com`);
      expect(real).toEqual(unknown);
      expect(sent.calls.map((c) => c.to)).toEqual([`staff-${stamp}@x.com`]);
      expect(sent.calls[0]!.body).toMatch(/\/set-password\?token=/);
    });

    it("from the clinic app, only emails that clinic's client account", async () => {
      await ask(`client-${stamp}@x.com`, slug);
      expect(sent.calls.map((c) => c.to)).toEqual([`client-${stamp}@x.com`]);
      sent.calls.length = 0;

      await ask(`client-${stamp}@x.com`, "some-other-clinic");
      await ask(`staff-${stamp}@x.com`, slug); // staff are not reset through a clinic's client app
      expect(sent.calls).toHaveLength(0);
    });

    it("from /login, never emails a client account", async () => {
      await ask(`client-${stamp}@x.com`);
      expect(sent.calls).toHaveLength(0);
    });

    it("stops sending after three requests an hour for one address, still answering the same", async () => {
      const email = `staff-${stamp}@x.com`;
      await rawDb.rateLimitBucket.deleteMany({ where: { key: `reset:email:${email}` } });
      const answers = [];
      for (let i = 0; i < 5; i++) answers.push(await ask(email));
      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
      expect(sent.calls).toHaveLength(3);
    });
  });

  it("sends staff to sign in and clients back to their clinic's app", async () => {
    const submit = async (userId: string) => {
      const fd = new FormData();
      fd.set("token", await issuePasswordToken(userId, 60_000));
      fd.set("password", "final-password-9");
      fd.set("confirm", "final-password-9");
      return setPasswordAction(undefined, fd);
    };
    await expect(submit(staffId)).rejects.toThrow("NEXT_REDIRECT:/login?reason=password-updated");
    await expect(submit(clientId)).rejects.toThrow(`NEXT_REDIRECT:/app/${slug}?password=updated`);
  });
});
