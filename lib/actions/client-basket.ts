"use server";

import { requireCustomerContext } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

/** Read-only helpers the client app's cart UI polls — no route dependency. */

export async function getBasketSummaryAction() {
  const { db, user } = await requireCustomerContext();
  const basket = await db.basket.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: "OPEN" },
    include: { items: true },
  });
  const count = basket?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;
  return { count };
}

export async function getBasketDetailAction() {
  const { db, user } = await requireCustomerContext();
  const basket = await db.basket.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: "OPEN" },
    include: { items: { include: { service: true, product: true, package: true } } },
  });
  return {
    basketId: basket?.id ?? null,
    items: (basket?.items ?? []).map((i) => ({
      id: i.id,
      name: i.service?.name ?? i.product?.name ?? i.package?.name ?? "Item",
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
    })),
  };
}

export async function updateClientBasketItemAction(itemId: string, quantity: number) {
  const { db, user } = await requireCustomerContext();
  const item = await db.basketItem.findFirst({
    where: { id: itemId, basket: { customerProfileId: user.customerProfileId!, status: "OPEN" } },
  });
  if (!item) return;
  if (quantity <= 0) {
    await db.basketItem.deleteMany({ where: { id: itemId } });
  } else {
    await db.basketItem.updateMany({ where: { id: itemId }, data: { quantity } });
  }
  revalidatePath("/app", "layout");
}
