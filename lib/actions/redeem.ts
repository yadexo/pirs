"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { notifyItemRedeemed, notifySessionUsed } from "@/lib/client-notifications";
import { spendPackageSession } from "@/lib/package-redemption";
import { findItem, isBackupCode, normaliseCode, redeemItem, tokenFromScan, toView, type ItemView } from "@/lib/redeemable";

/**
 * Redeeming a client's paid-for item at the clinic — by scanning their code,
 * typing the eight characters underneath it, or picking the item off the
 * client's own record when they have neither.
 *
 * Every path goes through the same two steps: look it up, then confirm. Staff
 * see what they are about to hand over before anything is marked used, and the
 * marking itself is the atomic update in lib/redeemable.ts.
 *
 * The clinic is always the session's own. A code belonging to another clinic
 * is not found here, so the answer is "not valid at this clinic" — it never
 * says whose it is or what it was.
 */

const NOT_VALID_HERE = "Not valid at this clinic.";

/** What staff scanned or typed, whichever it turns out to be. */
const scanned = z.object({ value: z.string().trim().min(1, "Scan a code or type one").max(200) });

export type LookupResult = ActionResult<{ item: ItemView }>;

export async function lookupRedeemableAction(merchantId: string, value: string): Promise<LookupResult> {
  return runAction(async () => {
    await requireMerchantAction(merchantId, "sales.manage");
    const input = scanned.parse({ value });

    // A scanned QR carries a token; a receptionist types the short code.
    const token = tokenFromScan(input.value);
    const lookup = token ? { token } : isBackupCode(input.value) ? { code: normaliseCode(input.value) } : null;
    if (!lookup) throw new ActionError("That isn't one of this clinic's item codes.");

    const item = await findItem(merchantId, lookup);
    if (!item) throw new ActionError(NOT_VALID_HERE);
    return { item };
  });
}

const confirm = z.object({
  itemId: z.string().min(1),
  method: z.enum(["QR", "BACKUP_CODE", "MANUAL"]),
  note: z.string().trim().max(200, "Keep the note under 200 characters").optional(),
});

export type RedeemResult = ActionResult<{ item: ItemView }>;

export async function redeemItemAction(merchantId: string, input: z.input<typeof confirm>): Promise<RedeemResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const { itemId, method, note } = confirm.parse(input);

    const outcome = await redeemItem({
      tenantId: merchantId,
      lookup: { id: itemId },
      staffUserId: ctx.user.id,
      method,
      note: method === "MANUAL" ? (note ?? null) : null,
    });

    if (!outcome.ok) {
      if (outcome.reason === "not-found") throw new ActionError(NOT_VALID_HERE);
      if (outcome.reason === "voided") throw new ActionError("This item was refunded, so it can't be redeemed.");
      if (outcome.reason === "expired") throw new ActionError("This item has expired.");
      const when = outcome.item?.redeemedAt ? new Date(outcome.item.redeemedAt).toLocaleString() : "earlier";
      const who = outcome.item?.redeemedByName ? ` by ${outcome.item.redeemedByName}` : "";
      throw new ActionError(`Already redeemed ${when}${who}.`);
    }

    await ctx.audit("redeemable.redeemed", "RedeemableItem", itemId, { method, name: outcome.item.name });

    // Told after the fact, and never able to undo it: the item is already
    // handed over whether or not the client's phone hears about it.
    const owner = await rawDb.redeemableItem.findFirst({
      where: { id: itemId, tenantId: merchantId },
      select: {
        name: true,
        customerProfile: { select: { userId: true } },
        tenant: { select: { slug: true, name: true, branding: { select: { businessName: true } } } },
      },
    });
    if (owner?.customerProfile?.userId) {
      await notifyItemRedeemed(
        owner.customerProfile.userId,
        owner.tenant.branding?.businessName ?? owner.tenant.name,
        owner.tenant.slug,
        owner.name,
      );
    }

    revalidatePath(`/m/${merchantId}/redeem`);
    return { item: outcome.item };
  });
}

/** Every item belonging to one client of this clinic, newest purchase first. */
export async function clientItemsAction(merchantId: string, customerProfileId: string): Promise<ActionResult<{ items: ItemView[] }>> {
  return runAction(async () => {
    await requireMerchantAction(merchantId, "sales.manage");
    const rows = await rawDb.redeemableItem.findMany({
      where: { tenantId: merchantId, customerProfileId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        itemType: true,
        status: true,
        code: true,
        createdAt: true,
        expiresAt: true,
        redeemedAt: true,
        redemptionMethod: true,
        refundedAfterUse: true,
        source: true,
        issuedReason: true,
        voidedReason: true,
        redeemedBy: { select: { email: true, staffProfile: { select: { firstName: true, lastName: true } } } },
        customerProfile: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
      },
    });
    return { items: rows.map((r) => toView(r as Parameters<typeof toView>[0])) };
  });
}

/* ------------------------------------------------------- session packages */

/**
 * A client's session packages, for the desk.
 *
 * A package has no code to scan — it is a count, not a ticket — so staff
 * reach it through the client rather than through a code. Expired and empty
 * ones come back too, with their reason, because "where did my sessions go"
 * is a question the desk has to be able to answer.
 */
export interface StaffPackageView {
  id: string;
  name: string;
  remainingUses: number;
  totalUses: number;
  expiresAt: string | null;
  expired: boolean;
  usable: boolean;
  /** The treatments a session may be spent on. */
  covers: { id: string; name: string }[];
  /** Most recent first: who used a session, when, and on what. */
  history: { id: string; serviceName: string; usedAt: string; staffName: string | null }[];
}

export async function clientPackagesAction(merchantId: string, customerProfileId: string): Promise<ActionResult<{ packages: StaffPackageView[] }>> {
  return runAction(async () => {
    await requireMerchantAction(merchantId, "sales.manage");
    const rows = await rawDb.customerPackage.findMany({
      where: { tenantId: merchantId, customerProfileId },
      orderBy: [{ expiresAt: "asc" }, { purchasedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        remainingUses: true,
        totalUses: true,
        expiresAt: true,
        status: true,
        package: { select: { name: true, items: { select: { service: { select: { id: true, name: true, active: true } } } } } },
        sessionUses: {
          orderBy: { usedAt: "desc" },
          take: 20,
          select: {
            id: true,
            usedAt: true,
            service: { select: { name: true } },
            usedBy: { select: { email: true, staffProfile: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });

    const now = new Date();
    return {
      packages: rows.map((r) => {
        const expired = !!r.expiresAt && r.expiresAt.getTime() <= now.getTime();
        return {
          id: r.id,
          name: r.package.name,
          remainingUses: r.remainingUses,
          totalUses: r.totalUses,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          expired,
          usable: !expired && r.remainingUses > 0 && r.status !== "TRANSFERRED",
          covers: r.package.items
            .map((i) => i.service)
            .filter((s): s is NonNullable<typeof s> => !!s && s.active)
            .map((s) => ({ id: s.id, name: s.name })),
          history: r.sessionUses.map((u) => ({
            id: u.id,
            serviceName: u.service?.name ?? "Treatment",
            usedAt: u.usedAt.toISOString(),
            staffName: u.usedBy?.staffProfile
              ? `${u.usedBy.staffProfile.firstName} ${u.usedBy.staffProfile.lastName}`.trim()
              : (u.usedBy?.email ?? null),
          })),
        };
      }),
    };
  });
}

const spendSession = z.object({
  customerPackageId: z.string().min(1),
  serviceId: z.string().min(1, "Choose the treatment"),
  note: z.string().trim().max(200, "Keep the note under 200 characters").optional(),
});

export type SpendSessionResult = ActionResult<{ remainingUses: number; totalUses: number; packageName: string; serviceName: string }>;

/**
 * Using one session at the desk.
 *
 * The count going down is the thing that matters, so it is done first and
 * conditionally — see lib/package-redemption.ts. Everything after it (the
 * audit log, the client's phone) describes something that has already
 * happened and cannot undo it.
 */
export async function spendPackageSessionAction(merchantId: string, input: z.input<typeof spendSession>): Promise<SpendSessionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const { customerPackageId, serviceId, note } = spendSession.parse(input);

    const outcome = await spendPackageSession({ tenantId: merchantId, customerPackageId, serviceId, staffUserId: ctx.user.id, note });
    if (!outcome.ok) throw new ActionError(outcome.message);

    await ctx.audit("package.session.used", "CustomerPackage", customerPackageId, {
      packageName: outcome.packageName,
      serviceName: outcome.serviceName,
      remainingUses: outcome.remainingUses,
      sessionUseId: outcome.useId,
    });

    // Told after the fact: the session is spent whether or not their phone
    // hears about it, so a failure here must not look like a failure to use.
    const owner = await rawDb.customerPackage.findFirst({
      where: { id: customerPackageId, tenantId: merchantId },
      select: { customerProfileId: true },
    });
    if (owner) {
      await notifySessionUsed(owner.customerProfileId, outcome.packageName, outcome.serviceName, outcome.remainingUses).catch(() => undefined);
    }

    revalidatePath(`/m/${merchantId}/clients`);
    return {
      remainingUses: outcome.remainingUses,
      totalUses: outcome.totalUses,
      packageName: outcome.packageName,
      serviceName: outcome.serviceName,
    };
  });
}
