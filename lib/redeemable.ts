import { randomBytes, randomInt } from "node:crypto";
import type { PrismaClient, RedeemableSource, RedeemableStatus, RedemptionMethod } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { CODE_ALPHABET, CODE_LENGTH, normaliseCode } from "@/lib/redeemable-shared";

/**
 * Things a client has paid for and can collect: a product to pick up, a
 * treatment to have. One row per unit, each with its own code, so buying two
 * and using one leaves the other usable.
 *
 * Two rules shape the whole file:
 *
 * Nothing is created until the money is confirmed. The webhook is the only
 * caller, and it can deliver the same event twice, so creation is written to
 * be safe to repeat rather than assumed to run once.
 *
 * Nothing is redeemed twice. The update is conditional on the row still being
 * AVAILABLE, so two people scanning the same code at the same moment leave
 * exactly one of them holding the redemption — Postgres decides which, and the
 * loser is told it has already been used.
 *
 * No "server-only" here: the backfill script runs outside Next.
 */

// The shape of a code — prefix, alphabet, parsing — is shared with the
// browser, which builds the QR the clinic scans.
export { CODE_ALPHABET, CODE_LENGTH, REDEEM_QR_PREFIX, isBackupCode, normaliseCode, redeemQrValue, tokenFromScan } from "@/lib/redeemable-shared";

export function generateBackupCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Not guessable, and not derived from anything about the client. */
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}
type Db = Pick<PrismaClient, "redeemableItem" | "order" | "$transaction">;

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/** Only things handed over in person. A membership is an arrangement, not an item. */
const REDEEMABLE_TYPES = ["PRODUCT", "SERVICE"] as const;

export interface CreatedItems {
  created: number;
  /** Already there from an earlier delivery of the same event. */
  existing: number;
}

/**
 * Turns a paid order into one redeemable item per unit bought.
 *
 * Safe to run twice: each row is keyed by its order line and unit number, and
 * a repeat run skips what is already there. A retried webhook, or the backfill
 * script over an order that already has items, changes nothing.
 */
export async function createItemsForOrder(orderId: string, db: Db = rawDb as Db, attempt = 0): Promise<CreatedItems> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      tenantId: true,
      customerProfileId: true,
      items: { select: { id: true, itemType: true, name: true, quantity: true } },
      redeemableItems: { select: { orderItemId: true, unitIndex: true } },
    },
  });
  if (!order) return { created: 0, existing: 0 };

  const already = new Set(order.redeemableItems.map((r) => `${r.orderItemId}:${r.unitIndex}`));
  const rows: {
    tenantId: string;
    customerProfileId: string;
    orderId: string;
    orderItemId: string;
    unitIndex: number;
    itemType: (typeof REDEEMABLE_TYPES)[number];
    name: string;
    token: string;
    code: string;
  }[] = [];

  for (const line of order.items) {
    if (!REDEEMABLE_TYPES.includes(line.itemType as (typeof REDEEMABLE_TYPES)[number])) continue;
    for (let unit = 0; unit < Math.max(1, line.quantity); unit++) {
      if (already.has(`${line.id}:${unit}`)) continue;
      rows.push({
        tenantId: order.tenantId,
        customerProfileId: order.customerProfileId,
        orderId: order.id,
        orderItemId: line.id,
        unitIndex: unit,
        itemType: line.itemType as (typeof REDEEMABLE_TYPES)[number],
        name: line.name,
        token: generateToken(),
        code: generateBackupCode(),
      });
    }
  }

  if (rows.length === 0) return { created: 0, existing: already.size };

  // skipDuplicates covers the race the check above cannot: two deliveries of
  // the same event arriving at once, both finding nothing and both inserting.
  const { count } = await db.redeemableItem.createMany({ data: rows, skipDuplicates: true });

  // A skipped row is almost always that race — but it could also be two
  // random codes colliding, which would quietly cost the client an item. One
  // more pass either finds the rows the other delivery wrote (and creates
  // nothing) or writes the missing ones with fresh codes.
  if (count < rows.length && attempt < 2) {
    const retry = await createItemsForOrder(orderId, db, attempt + 1);
    return { created: count + retry.created, existing: already.size };
  }

  return { created: count, existing: already.size };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export interface VoidResult {
  voided: number;
  /** Items already used when the refund came in. The clinic decides. */
  alreadyRedeemed: number;
}

/**
 * A refunded order's unused items stop working. Used ones are left alone and
 * flagged instead: the client has had the thing, so silently marking it void
 * would hide that from the clinic.
 */
export async function voidItemsForOrder(orderId: string, db: Db = rawDb as Db): Promise<VoidResult> {
  const [voided, flagged] = await Promise.all([
    db.redeemableItem.updateMany({ where: { orderId, status: "AVAILABLE" }, data: { status: "VOIDED" } }),
    db.redeemableItem.updateMany({ where: { orderId, status: "REDEEMED" }, data: { refundedAfterUse: true } }),
  ]);
  return { voided: voided.count, alreadyRedeemed: flagged.count };
}

// ---------------------------------------------------------------------------
// Looking up and redeeming
// ---------------------------------------------------------------------------

export interface ItemView {
  id: string;
  name: string;
  itemType: string;
  status: RedeemableStatus;
  code: string;
  purchasedAt: Date;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redeemedByName: string | null;
  redemptionMethod: RedemptionMethod | null;
  refundedAfterUse: boolean;
  /** Bought, given by the clinic, or a replacement code for an earlier one. */
  source: RedeemableSource;
  /** Why a staff member gave it or took it back, when one did. */
  issuedReason: string | null;
  voidedReason: string | null;
  client: { name: string; email: string | null };
}

export type Lookup = { token: string } | { code: string } | { id: string };

function whereFor(tenantId: string, lookup: Lookup) {
  if ("token" in lookup) return { tenantId, token: lookup.token };
  if ("code" in lookup) return { tenantId, code: normaliseCode(lookup.code) };
  return { tenantId, id: lookup.id };
}

const VIEW_SELECT = {
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
  redeemedBy: { select: { staffProfile: { select: { firstName: true, lastName: true } }, email: true } },
  customerProfile: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
} as const;

type RowWithView = {
  id: string;
  name: string;
  itemType: string;
  status: RedeemableStatus;
  code: string;
  createdAt: Date;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redemptionMethod: RedemptionMethod | null;
  refundedAfterUse: boolean;
  source: RedeemableSource;
  issuedReason: string | null;
  voidedReason: string | null;
  redeemedBy: { email: string; staffProfile: { firstName: string; lastName: string } | null } | null;
  customerProfile: { firstName: string; lastName: string; user: { email: string } | null };
};

export function toView(row: RowWithView): ItemView {
  const staff = row.redeemedBy?.staffProfile;
  return {
    id: row.id,
    name: row.name,
    itemType: row.itemType,
    status: row.status,
    code: row.code,
    purchasedAt: row.createdAt,
    expiresAt: row.expiresAt,
    redeemedAt: row.redeemedAt,
    redeemedByName: staff ? `${staff.firstName} ${staff.lastName}`.trim() : (row.redeemedBy?.email ?? null),
    redemptionMethod: row.redemptionMethod,
    refundedAfterUse: row.refundedAfterUse,
    source: row.source,
    issuedReason: row.issuedReason,
    voidedReason: row.voidedReason,
    client: {
      name: `${row.customerProfile.firstName} ${row.customerProfile.lastName}`.trim(),
      email: row.customerProfile.user?.email ?? null,
    },
  };
}

/**
 * Finds an item for the clinic doing the looking. A code from another clinic
 * simply isn't found — the caller says "not valid here" without ever having
 * seen whose it is.
 */
export async function findItem(tenantId: string, lookup: Lookup, db: Db = rawDb as Db): Promise<ItemView | null> {
  const row = await db.redeemableItem.findFirst({ where: whereFor(tenantId, lookup), select: VIEW_SELECT });
  return row ? toView(row as RowWithView) : null;
}

export type RedeemOutcome =
  | { ok: true; item: ItemView }
  | { ok: false; reason: "not-found" | "already-redeemed" | "voided" | "expired"; item?: ItemView };

export interface RedeemInput {
  tenantId: string;
  lookup: Lookup;
  staffUserId: string;
  method: RedemptionMethod;
  note?: string | null;
  now?: Date;
}

/**
 * Marks one item as collected, once.
 *
 * The write is a conditional updateMany, not a read-then-write: it only
 * touches a row that is still AVAILABLE, so of two staff scanning the same
 * code at the same instant exactly one gets count 1 and the other gets 0 and
 * is told it has already been used.
 */
export async function redeemItem(input: RedeemInput, db: Db = rawDb as Db): Promise<RedeemOutcome> {
  const now = input.now ?? new Date();
  const where = whereFor(input.tenantId, input.lookup);

  const existing = await db.redeemableItem.findFirst({ where, select: VIEW_SELECT });
  if (!existing) return { ok: false, reason: "not-found" };
  const item = toView(existing as RowWithView);

  if (item.status === "REDEEMED") return { ok: false, reason: "already-redeemed", item };
  if (item.status === "VOIDED") return { ok: false, reason: "voided", item };
  if (item.status === "EXPIRED" || (item.expiresAt && item.expiresAt <= now)) return { ok: false, reason: "expired", item };

  const { count } = await db.redeemableItem.updateMany({
    where: { ...where, status: "AVAILABLE" },
    data: {
      status: "REDEEMED",
      redeemedAt: now,
      redeemedById: input.staffUserId,
      redemptionMethod: input.method,
      redemptionNote: input.note?.trim() || null,
    },
  });

  // Someone else got there first, in the moment between the read and the write.
  if (count === 0) {
    const after = await db.redeemableItem.findFirst({ where, select: VIEW_SELECT });
    return { ok: false, reason: "already-redeemed", item: after ? toView(after as RowWithView) : item };
  }

  const saved = await db.redeemableItem.findFirst({ where, select: VIEW_SELECT });
  return { ok: true, item: saved ? toView(saved as RowWithView) : item };
}
