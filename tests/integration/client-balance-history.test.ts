import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { getBalanceHistory } from "@/lib/client-app-data";
import { adjustAccountCredit } from "@/lib/account-credit";
import { adjustLoyaltyPoints } from "@/lib/loyalty";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

/**
 * What the client sees in their own app when the clinic moves their balance.
 *
 * A push notification scrolls away; this is where somebody goes a week later
 * to find out why they have ten euros they do not remember earning. It shows
 * the clinic's own reason, and deliberately leaves out the movements that are
 * already explained by an order.
 */
describe("a client's credit and points history", () => {
  const stamp = Date.now();
  let clinic: string;
  let customerProfileId: string;
  let db: ReturnType<typeof getTenantDb>;

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug: `bal-${stamp}`, name: "Balance Clinic" } })).id;
    db = getTenantDb(clinic);
    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `b-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    customerProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Bea", lastName: "Balance" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    await rawDb.accountCreditTransaction.deleteMany({ where: { tenantId: clinic } });
    await rawDb.loyaltyTransaction.deleteMany({ where: { tenantId: clinic } });
    await rawDb.customerProfile.update({
      where: { id: customerProfileId },
      data: { accountCreditBalanceCents: 0, loyaltyPointsBalance: 0 },
    });
  });

  it("shows credit the clinic added, in the clinic's own words", async () => {
    await adjustAccountCredit(db, { customerProfileId, amountCents: 1_000, type: "MANUAL_ADJUSTMENT", reason: "goodwill" });

    const [row] = await getBalanceHistory(db, customerProfileId);
    expect(row).toMatchObject({ kind: "credit", amount: 1_000, headline: "Credit added", reason: "goodwill" });
  });

  it("says when credit was taken away, rather than quietly showing less", async () => {
    await adjustAccountCredit(db, { customerProfileId, amountCents: 2_000, type: "MANUAL_ADJUSTMENT", reason: "goodwill" });
    await adjustAccountCredit(db, { customerProfileId, amountCents: -500, type: "MANUAL_ADJUSTMENT", reason: "used at the desk" });

    const [newest] = await getBalanceHistory(db, customerProfileId);
    expect(newest).toMatchObject({ amount: -500, headline: "Credit removed", reason: "used at the desk" });
  });

  it("names a membership grant as what it is", async () => {
    await adjustAccountCredit(db, { customerProfileId, amountCents: 1_500, type: "MEMBERSHIP_GRANT", reason: "Glow Monthly credit for this period" });

    expect((await getBalanceHistory(db, customerProfileId))[0]).toMatchObject({ headline: "Credit from your membership" });
  });

  it("shows points the clinic moved too", async () => {
    await adjustLoyaltyPoints(db, { customerProfileId, points: 150, type: "MANUAL_ADJUSTMENT", reason: "referred a friend" });

    const [row] = await getBalanceHistory(db, customerProfileId);
    expect(row).toMatchObject({ kind: "points", amount: 150, headline: "Points added", reason: "referred a friend" });
  });

  it("leaves out what an order already explains", async () => {
    // Earning points by buying something, and spending credit at checkout,
    // are both on the order. Repeating them here buries the ones that need
    // explaining.
    await adjustLoyaltyPoints(db, { customerProfileId, points: 50, type: "EARNED", reason: "Earned from purchase" });
    await adjustAccountCredit(db, { customerProfileId, amountCents: 5_000, type: "MANUAL_ADJUSTMENT", reason: "goodwill" });
    await adjustAccountCredit(db, { customerProfileId, amountCents: -1_000, type: "REDEEMED", reason: "Applied to order ORD-1" });

    const rows = await getBalanceHistory(db, customerProfileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "goodwill" });
  });

  it("puts the two balances in one list, newest first", async () => {
    await adjustAccountCredit(db, { customerProfileId, amountCents: 1_000, type: "MANUAL_ADJUSTMENT", reason: "first" });
    await adjustLoyaltyPoints(db, { customerProfileId, points: 10, type: "MANUAL_ADJUSTMENT", reason: "second" });

    const rows = await getBalanceHistory(db, customerProfileId);
    expect(rows.map((r) => r.reason)).toEqual(["second", "first"]);
  });

  it("shows nothing for a client whose clinic has never touched their balance", async () => {
    expect(await getBalanceHistory(db, customerProfileId)).toEqual([]);
  });
});
