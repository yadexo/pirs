import { rawDb } from "@/lib/db";
import { packageExpiresAt } from "@/lib/package-pricing";

/**
 * Turning a paid order into the sessions a client owns.
 *
 * A session package is not a redeemable item: one order line is N sessions
 * that get spent one at a time, so it becomes a CustomerPackage with a count
 * rather than N codes. The end date is worked out here, from the day of
 * purchase, and then never recalculated — a clinic that later shortens
 * "valid 365 days" must not shorten what somebody has already bought.
 *
 * Safe to run twice. A retried webhook finds the rows already there and
 * creates nothing, which is why the order line's id is what identifies them.
 */

type Db = typeof rawDb;

export interface CreatedPackages {
  created: number;
  existing: number;
}

export async function createPackagesForOrder(orderId: string, db: Db = rawDb, now: Date = new Date()): Promise<CreatedPackages> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      tenantId: true,
      customerProfileId: true,
      items: {
        where: { itemType: "PACKAGE" },
        select: { id: true, quantity: true, package: { select: { id: true, totalUses: true, expiryDays: true } } },
      },
    },
  });
  if (!order || order.items.length === 0) return { created: 0, existing: 0 };

  const existingRows = await db.customerPackage.findMany({
    where: { orderItemId: { in: order.items.map((i) => i.id) } },
    select: { orderItemId: true },
  });
  const already = new Set(existingRows.map((r) => r.orderItemId));

  const rows = [];
  for (const line of order.items) {
    if (!line.package || already.has(line.id)) continue;
    // Buying two of the same package is two sets of sessions with their own
    // counts, not one set of double the size — each expires on its own terms.
    for (let unit = 0; unit < Math.max(1, line.quantity); unit++) {
      rows.push({
        tenantId: order.tenantId,
        customerProfileId: order.customerProfileId,
        packageId: line.package.id,
        orderItemId: line.id,
        remainingUses: line.package.totalUses,
        totalUses: line.package.totalUses,
        purchasedAt: now,
        expiresAt: packageExpiresAt(now, line.package.expiryDays),
      });
    }
  }

  if (rows.length === 0) return { created: 0, existing: already.size };

  const { count } = await db.customerPackage.createMany({ data: rows as never });
  return { created: count, existing: already.size };
}
