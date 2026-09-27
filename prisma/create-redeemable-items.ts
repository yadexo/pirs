/**
 * Gives already-paid orders the redeemable items they would have got if this
 * feature had existed when they were placed.
 *
 *   npx tsx prisma/create-redeemable-items.ts                      # every clinic
 *   npx tsx prisma/create-redeemable-items.ts --clinic testclinic  # just one
 *   npx tsx prisma/create-redeemable-items.ts --dry-run            # count only
 *
 * Safe to run twice. Items are keyed by order line and unit number, so a
 * second run finds everything already there and creates nothing.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createItemsForOrder } from "../lib/redeemable";
import { AdminSetupError, arg, confirmOrCancel, describeDatabase, exitWith, flag } from "./admin-cli";

export interface BackfillResult {
  orders: number;
  created: number;
  skipped: number;
}

export async function backfillRedeemableItems(
  db: PrismaClient,
  options: { clinicSlug?: string; dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const slug = options.clinicSlug?.trim().toLowerCase();

  let tenantId: string | undefined;
  if (slug) {
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) throw new AdminSetupError(`There is no clinic with the address "${slug}". Nothing was changed.`);
    tenantId = tenant.id;
  }

  // Paid and part-refunded orders both leave the client holding something.
  const orders = await db.order.findMany({
    where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, ...(tenantId ? { tenantId } : {}) },
    select: { id: true },
    orderBy: { placedAt: "asc" },
  });

  let created = 0;
  let skipped = 0;
  for (const order of orders) {
    if (options.dryRun) {
      const existing = await db.redeemableItem.count({ where: { orderId: order.id } });
      if (existing > 0) skipped += existing;
      continue;
    }
    const result = await createItemsForOrder(order.id, db);
    created += result.created;
    skipped += result.existing;
  }

  return { orders: orders.length, created, skipped };
}

async function main() {
  const clinicSlug = arg("clinic");
  const dryRun = flag("dry-run");
  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);

  const db = new PrismaClient();
  try {
    if (!dryRun) {
      await confirmOrCancel(
        `About to create redeemable items for paid orders${clinicSlug ? ` of clinic "${clinicSlug}"` : " of every clinic"}. Existing items are left alone.`,
      );
    }
    const result = await backfillRedeemableItems(db, { clinicSlug, dryRun });
    console.log(
      dryRun
        ? `\n${result.orders} paid order(s); ${result.skipped} item(s) already exist. Nothing was changed.`
        : `\n${result.orders} paid order(s): created ${result.created} item(s), left ${result.skipped} already there.`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
