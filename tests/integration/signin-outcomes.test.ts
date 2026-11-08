/**
 * Every way a sign-in can end leaves one reason-coded line in the logs, and
 * never anything that identifies the person. What the caller gets back is
 * exactly what it was before the logging existed.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { generateTotpSecret, totpCode } from "@/lib/totp";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
const { authorizeCredentials } = await import("@/lib/auth-credentials");
const { loadLiveAccount } = await import("@/lib/live-account");

const PASSWORD = "outcomes-Password-123!";
const WRONG = "definitely-not-the-password-1";

describe("sign-in outcomes in the logs", () => {
  const stamp = Date.now();
  const addr = (name: string) => `so-${name}-${stamp}@example.com`;
  let tenantId: string;
  let suspendedTenantId: string;
  let otherTenantId: string;
  const ids: Record<string, string> = {};
  const secret = generateTotpSecret();

  /** Every [signin] line written while `run` runs, whichever level it used. */
  const seen: string[] = [];
  async function capture(run: () => Promise<unknown>): Promise<{ lines: string[]; result: unknown; error: unknown }> {
    const lines: string[] = [];
    const record = (...args: unknown[]) => {
      const text = String(args[0]);
      if (text.startsWith("[signin]")) {
        lines.push(text);
        seen.push(text);
      }
    };
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(console, "info").mockImplementation(record);
    let result: unknown;
    let error: unknown;
    try {
      result = await run();
    } catch (err) {
      error = err;
    }
    return { lines, result, error };
  }
  const staff = (email: string, extra: Record<string, unknown> = {}) => authorizeCredentials({ portal: "staff", email, password: PASSWORD, ...extra }, "staff", `198.51.100.${(stamp % 200) + 1}`);

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: `so-${stamp}`, name: "Outcomes Clinic" } })).id;
    otherTenantId = (await rawDb.tenant.create({ data: { slug: `so-other-${stamp}`, name: "Other Outcomes Clinic" } })).id;
    suspendedTenantId = (await rawDb.tenant.create({ data: { slug: `so-susp-${stamp}`, name: "Suspended Clinic", status: "SUSPENDED" } })).id;
    const passwordHash = await hashPassword(PASSWORD);
    const user = async (name: string, data: Record<string, unknown>) => {
      ids[name] = (await rawDb.user.create({ data: { email: addr(name), passwordHash, ...data } as never })).id;
    };

    await user("admin", { role: "PLATFORM_ADMIN" });
    await user("disabled", { role: "PLATFORM_ADMIN", status: "DISABLED" });
    await user("twofa", { role: "PLATFORM_ADMIN" });
    await rawDb.twoFactorSecret.create({ data: { userId: ids.twofa!, secret, confirmedAt: new Date() } });
    await user("suspended", { tenantId: suspendedTenantId, role: "TENANT_ADMIN" });
    // A staff member whose profile is missing: cannot sign in.
    await user("noprofile", { tenantId, role: "STAFF" });
    // The same address on two clinics: ambiguous.
    await user("ambiguous", { tenantId, role: "TENANT_ADMIN" });
    await rawDb.user.create({ data: { tenantId: otherTenantId, email: addr("ambiguous"), passwordHash, role: "TENANT_ADMIN" } });

    // One person, one address, three accounts of different kinds — which used
    // to refuse all three. The client is at the *other* clinic because
    // User's @@unique([tenantId, email]) forbids two accounts of any kind on
    // one address at one clinic.
    await user("everything", { role: "PLATFORM_ADMIN" });
    await rawDb.user.create({ data: { tenantId, email: addr("everything"), passwordHash, role: "TENANT_ADMIN" } });
    const client = await rawDb.user.create({ data: { tenantId: otherTenantId, email: addr("everything"), passwordHash, role: "CUSTOMER" } });
    await rawDb.customerProfile.create({ data: { tenantId: otherTenantId, userId: client.id, firstName: "Ever", lastName: "Ything" } });
  });

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    for (const id of [tenantId, otherTenantId, suspendedTenantId]) await deleteTenantCompletely(id).catch(() => undefined);
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { contains: `-${stamp}@` } } });
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { contains: `198.51.100.${(stamp % 200) + 1}` } } });
    // Fixed addresses this file uses: left behind, they would count towards the
    // IP limit on a rerun inside the same ten-minute window.
    for (const ip of ["198.51.100.210", "198.51.100.240", "198.51.100.250", "198.51.100.251"]) {
      await rawDb.rateLimitBucket.deleteMany({ where: { key: `login:ip:${ip}` } });
    }
  });

  afterEach(() => vi.restoreAllMocks());

  describe("the credentials step", () => {
    it("logs a success with the role, and returns the account", async () => {
      const { lines, result } = await capture(() => staff(addr("admin")));
      expect(result).toMatchObject({ role: "PLATFORM_ADMIN" });
      expect(lines).toEqual(["[signin] outcome=success audience=staff portal=staff role=PLATFORM_ADMIN"]);
    });

    it("logs a wrong password as that, and still returns plain null", async () => {
      const { lines, result } = await capture(() => authorizeCredentials({ portal: "staff", email: addr("admin"), password: WRONG }, "staff", "198.51.100.250"));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=wrong_password audience=staff portal=staff role=PLATFORM_ADMIN"]);
    });

    it("tells an unknown address apart in the logs, though the caller can't tell", async () => {
      const unknown = await capture(() => staff(addr("nobody")));
      const wrong = await capture(() => authorizeCredentials({ portal: "staff", email: addr("admin"), password: WRONG }, "staff", "198.51.100.251"));
      expect(unknown.lines).toEqual(["[signin] outcome=no_such_user audience=staff portal=staff"]);
      // To the caller both are the same thing, which is the point.
      expect(unknown.result).toBeNull();
      expect(wrong.result).toBeNull();
    });

    it("says when the address is on two accounts, and which roles", async () => {
      const { lines, result } = await capture(() => staff(addr("ambiguous")));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=ambiguous_email audience=staff portal=staff roles=TENANT_ADMIN+TENANT_ADMIN"]);
    });

    it("says when the account is not active", async () => {
      const { lines, result } = await capture(() => staff(addr("disabled")));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=account_not_active audience=staff portal=staff role=PLATFORM_ADMIN"]);
    });

    it("says when the clinic is suspended", async () => {
      const { lines, result } = await capture(() => staff(addr("suspended")));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=clinic_not_active audience=staff portal=staff role=TENANT_ADMIN"]);
    });

    it("says when a staff member has no usable profile", async () => {
      const { lines, result } = await capture(() => staff(addr("noprofile")));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=staff_blocked audience=staff portal=staff role=STAFF"]);
    });

    it("says when something was missing from the request", async () => {
      const { lines, result } = await capture(() => authorizeCredentials({ portal: "staff", email: addr("admin") }, "staff"));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=missing_fields audience=staff"]);
    });

    it("says when an address has an account, but not of this door's kind", async () => {
      // The clinic owner typing their address into the admin login. From the
      // outside this is the same generic failure as a wrong password; in the
      // logs it is the one line that explains the support call.
      const { lines, result } = await capture(() =>
        authorizeCredentials({ portal: "admin", email: addr("suspended"), password: PASSWORD }, "staff", "198.51.100.240"),
      );
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=no_account_of_type audience=staff portal=admin"]);
    });

    it("says when the door doesn't fit the session", async () => {
      const { lines, result } = await capture(() => authorizeCredentials({ portal: "customer", tenantSlug: `so-${stamp}`, email: addr("admin"), password: PASSWORD }, "staff"));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=invalid_portal audience=staff portal=customer"]);
    });
  });

  describe("one address, three accounts, three doors", () => {
    // The bug this fixes: the staff sign-in looked an address up across every
    // staff role at once and refused whenever it found more than one, so the
    // person who is a platform admin, a clinic owner and a client could not
    // sign in anywhere at all.
    const ip = "198.51.100.210";
    const at = (portal: string, extra: Record<string, unknown> = {}) =>
      authorizeCredentials({ portal, email: addr("everything"), password: PASSWORD, ...extra }, portal === "customer" ? "client" : "staff", ip);

    it("the admin door signs in the platform admin", async () => {
      await expect(at("admin")).resolves.toMatchObject({ role: "PLATFORM_ADMIN", tenantId: null });
    });

    it("the clinic door signs in the clinic account", async () => {
      await expect(at("clinic")).resolves.toMatchObject({ role: "TENANT_ADMIN", tenantId, tenantSlug: `so-${stamp}` });
    });

    it("the clinic's own app signs in the client", async () => {
      await expect(at("customer", { tenantSlug: `so-other-${stamp}` })).resolves.toMatchObject({ role: "CUSTOMER", tenantId: otherTenantId });
    });

    it("the staff fallback prefers the platform admin, and never the client", async () => {
      await expect(at("staff")).resolves.toMatchObject({ role: "PLATFORM_ADMIN" });
    });

    it("logs each of them as a plain success, naming the door", async () => {
      const { lines } = await capture(() => at("admin"));
      expect(lines).toEqual(["[signin] outcome=success audience=staff portal=admin role=PLATFORM_ADMIN"]);
    });
  });

  describe("two-factor", () => {
    it("notes that a code was asked for — informationally, since it is the normal first step", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(staff(addr("twofa"))).rejects.toThrow(/__2fa_required__/);
      expect(info).toHaveBeenCalledWith("[signin] outcome=two_factor_required audience=staff portal=staff role=PLATFORM_ADMIN");
      expect(warn).not.toHaveBeenCalled();
      seen.push(...info.mock.calls.map((c) => String(c[0])));
    });

    it("logs a wrong code as a warning, and still throws what it always threw", async () => {
      const wrongCode = totpCode(secret) === "000000" ? "111111" : "000000";
      const { lines, error } = await capture(() => staff(addr("twofa"), { totpCode: wrongCode }));
      expect((error as Error).message).toMatch(/__2fa_invalid_code__/);
      expect(lines).toEqual(["[signin] outcome=two_factor_invalid_code audience=staff portal=staff role=PLATFORM_ADMIN"]);
    });

    it("logs a success once the right code is given", async () => {
      const { lines, result } = await capture(() => staff(addr("twofa"), { totpCode: totpCode(secret, Date.now() + 30_000) }));
      expect(result).toMatchObject({ role: "PLATFORM_ADMIN" });
      expect(lines).toEqual(["[signin] outcome=success audience=staff portal=staff role=PLATFORM_ADMIN"]);
    });
  });

  describe("rate limits", () => {
    it("names the account limit, with the same sentinel as before", async () => {
      const email = addr("limited");
      let last: { lines: string[]; error: unknown } = { lines: [], error: null };
      for (let i = 0; i < 11; i++) {
        // A fresh address each time, so only the account counter can trip.
        last = await capture(() => authorizeCredentials({ portal: "staff", email, password: WRONG }, "staff", `203.0.113.${100 + i}`));
        if (last.error) break;
      }
      expect((last.error as Error).message).toMatch(/^__rate_limited__:\d+/);
      expect(last.lines).toEqual(["[signin] outcome=rate_limited_account audience=staff portal=staff"]);
    }, 60000);

    it("names the address limit when that is what tripped", async () => {
      const ip = "198.51.100.77";
      await rawDb.rateLimitBucket.deleteMany({ where: { key: `login:ip:${ip}` } });
      let last: { lines: string[]; error: unknown } = { lines: [], error: null };
      for (let i = 0; i < 31; i++) {
        last = await capture(() => authorizeCredentials({ portal: "staff", email: addr(`ip-${i}`), password: WRONG }, "staff", ip));
        if (last.error) break;
      }
      expect((last.error as Error).message).toMatch(/^__rate_limited__:\d+/);
      expect(last.lines).toEqual(["[signin] outcome=rate_limited_ip audience=staff portal=staff"]);
      await rawDb.rateLimitBucket.deleteMany({ where: { key: `login:ip:${ip}` } });
    }, 60000);
  });

  describe("a session refused after a correct sign-in", () => {
    const sessionStart = () => Date.now();

    it("says nothing for a session that is fine", async () => {
      const { lines, result } = await capture(() => loadLiveAccount(ids.admin!, sessionStart()));
      expect(result).toMatchObject({ role: "PLATFORM_ADMIN" });
      expect(lines).toEqual([]);
    });

    it("explains a refusal after a reset, and how far ahead the cut-off was", async () => {
      await rawDb.user.update({ where: { id: ids.admin! }, data: { sessionsValidAfter: new Date(Date.now() + 5 * 60_000) } });
      const { lines, result } = await capture(() => loadLiveAccount(ids.admin!, sessionStart()));
      expect(result).toBeNull();
      expect(lines).toHaveLength(1);
      const ahead = Number(/^\[signin\] outcome=session_refused_after_reset ahead_s=(\d+)$/.exec(lines[0]!)?.[1]);
      // About five minutes: a clock that disagreed, rather than a reset moments ago.
      expect(ahead).toBeGreaterThan(290);
      expect(ahead).toBeLessThanOrEqual(300);
    });

    it("tells a real, recent reset from a clock that disagreed — by how far ahead it was", async () => {
      await rawDb.user.update({ where: { id: ids.admin! }, data: { sessionsValidAfter: new Date() } });
      const older = Date.now() - 3000;
      const { lines } = await capture(() => loadLiveAccount(ids.admin!, older));
      const ahead = Number(/ahead_s=(\d+)/.exec(lines[0]!)?.[1]);
      expect(ahead).toBeLessThan(10);
    });

    it("lets a session that began after the reset through, without a line", async () => {
      await rawDb.user.update({ where: { id: ids.admin! }, data: { sessionsValidAfter: new Date(Date.now() - 5 * 60_000) } });
      const { lines, result } = await capture(() => loadLiveAccount(ids.admin!, sessionStart()));
      expect(result).toMatchObject({ role: "PLATFORM_ADMIN" });
      expect(lines).toEqual([]);
    });

    it("says so when the session has no start time at all", async () => {
      const { lines, result } = await capture(() => loadLiveAccount(ids.admin!, undefined));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=session_refused_no_auth_time"]);
    });

    it("says so when the account has been switched off since", async () => {
      const { lines, result } = await capture(() => loadLiveAccount(ids.disabled!, sessionStart()));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=session_refused_account_inactive"]);
    });

    it("says so when the staff member can no longer act", async () => {
      const { lines, result } = await capture(() => loadLiveAccount(ids.noprofile!, sessionStart()));
      expect(result).toBeNull();
      expect(lines).toEqual(["[signin] outcome=session_refused_staff_blocked"]);
    });
  });

  it("never wrote an address, a password, an IP address or a name into any line, in any of the above", () => {
    expect(seen.length).toBeGreaterThan(15);
    const everything = seen.join("\n");
    for (const leak of [stamp.toString(), "example.com", "@", PASSWORD, WRONG, "198.51.100", "203.0.113", "Outcomes Clinic", `so-${stamp}`, secret]) {
      expect(everything, `a line contained ${leak}`).not.toContain(leak);
    }
    // And every line has the one fixed shape.
    for (const line of seen) expect(line).toMatch(/^\[signin\] outcome=[a-z_]+( (audience|portal|role|roles|ahead_s)=[A-Za-z0-9_+-]+)*$/);
  });
});
