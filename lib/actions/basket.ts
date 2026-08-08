"use server";

import { revalidatePath } from "next/cache";
import { requireCustomerContext } from "@/lib/rbac";
import type { TenantDb } from "@/lib/tenant-db";

async function getOrCreateOpenBasket(db: TenantDb, customerProfileId: string) {
  const existing = await db.basket.findFirst({ where: { customerProfileId, status: "OPEN" } });
  if (existing) return existing;
  return db.basket.create({ data: { customerProfileId, status: "OPEN" } as never });
}

export async function addServiceToBasketAction(tenantSlug: string, serviceId: string) {
  const { db, user } = await requireCustomerContext();
  const service = await db.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) throw new Error("Service not found.");

  const basket = await getOrCreateOpenBasket(db, user.customerProfileId!);
  const existingItem = await db.basketItem.findFirst({ where: { basketId: basket.id, serviceId } });
  if (existingItem) {
    await db.basketItem.updateMany({ where: { id: existingItem.id }, data: { quantity: { increment: 1 } } });
  } else {
    await db.basketItem.create({
      data: { basketId: basket.id, itemType: "SERVICE", serviceId, quantity: 1, unitPriceCents: service.priceCents },
    });
  }
  revalidatePath(`/${tenantSlug}/basket`);
}

export async function addProductToBasketAction(tenantSlug: string, productId: string, quantity = 1) {
  const { db, user } = await requireCustomerContext();
  const product = await db.product.findFirst({ where: { id: productId, active: true } });
  if (!product) throw new Error("Product not found.");
  if (product.inventoryQuantity < quantity) throw new Error("Not enough stock available.");

  const basket = await getOrCreateOpenBasket(db, user.customerProfileId!);
  const existingItem = await db.basketItem.findFirst({ where: { basketId: basket.id, productId } });
  if (existingItem) {
    await db.basketItem.updateMany({ where: { id: existingItem.id }, data: { quantity: { increment: quantity } } });
  } else {
    await db.basketItem.create({
      data: { basketId: basket.id, itemType: "PRODUCT", productId, quantity, unitPriceCents: product.priceCents },
    });
  }
  revalidatePath(`/${tenantSlug}/basket`);
}

export async function addPackageToBasketAction(tenantSlug: string, packageId: string) {
  const { db, user } = await requireCustomerContext();
  const pkg = await db.package.findFirst({ where: { id: packageId, active: true } });
  if (!pkg) throw new Error("Package not found.");

  const basket = await getOrCreateOpenBasket(db, user.customerProfileId!);
  const existingItem = await db.basketItem.findFirst({ where: { basketId: basket.id, packageId } });
  if (existingItem) {
    await db.basketItem.updateMany({ where: { id: existingItem.id }, data: { quantity: { increment: 1 } } });
  } else {
    await db.basketItem.create({
      data: { basketId: basket.id, itemType: "PACKAGE", packageId, quantity: 1, unitPriceCents: pkg.priceCents },
    });
  }
  revalidatePath(`/${tenantSlug}/basket`);
}

export async function updateBasketItemQuantityAction(tenantSlug: string, itemId: string, quantity: number) {
  const { db, user } = await requireCustomerContext();
  const item = await db.basketItem.findFirst({
    where: { id: itemId, basket: { customerProfileId: user.customerProfileId!, status: "OPEN" } },
  });
  if (!item) throw new Error("Basket item not found.");

  if (quantity <= 0) {
    await db.basketItem.deleteMany({ where: { id: itemId } });
  } else {
    await db.basketItem.updateMany({ where: { id: itemId }, data: { quantity } });
  }
  revalidatePath(`/${tenantSlug}/basket`);
}

export async function removeBasketItemAction(tenantSlug: string, itemId: string) {
  const { db, user } = await requireCustomerContext();
  await db.basketItem.deleteMany({
    where: { id: itemId, basket: { customerProfileId: user.customerProfileId!, status: "OPEN" } },
  });
  revalidatePath(`/${tenantSlug}/basket`);
}
