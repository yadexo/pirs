"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

function dollarsToCents(value: FormDataEntryValue | null): number {
  const n = Number(value ?? 0);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Service categories
// ---------------------------------------------------------------------------

export async function createServiceCategoryAction(_prevState: unknown, formData: FormData) {
  const { db } = await requireStaffContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  await db.serviceCategory.create({ data: { name, sortOrder: 0 } as never });
  revalidatePath("/admin/services");
  return { success: true };
}

export async function updateServiceCategoryAction(id: string, _prevState: unknown, formData: FormData) {
  const { db } = await requireStaffContext();
  const name = String(formData.get("name") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder") ?? 0);
  const active = formData.get("active") === "on";
  if (!name) return { error: "Name is required." };
  await db.serviceCategory.updateMany({ where: { id }, data: { name, sortOrder, active } });
  revalidatePath("/admin/services");
  return { success: true };
}

export async function archiveServiceCategoryAction(id: string) {
  const { db } = await requireStaffContext();
  await db.serviceCategory.updateMany({ where: { id }, data: { active: false } });
  revalidatePath("/admin/services");
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const serviceSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  categoryId: z.string().min(1, "Category is required"),
  description: z.string().max(2000).optional(),
  prepInstructions: z.string().max(2000).optional(),
  aftercareInstructions: z.string().max(2000).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(600),
  taxable: z.boolean().optional(),
});

export async function createServiceAction(_prevState: unknown, formData: FormData) {
  const { db, user } = await requireStaffContext();
  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description") || undefined,
    prepInstructions: formData.get("prepInstructions") || undefined,
    aftercareInstructions: formData.get("aftercareInstructions") || undefined,
    durationMinutes: formData.get("durationMinutes"),
    taxable: formData.get("taxable") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const priceCents = dollarsToCents(formData.get("price"));
  if (priceCents < 0) return { error: "Price must be zero or more." };

  const imageUrl = String(formData.get("imageUrl") ?? "") || undefined;

  const service = await db.service.create({
    data: { ...parsed.data, priceCents, imageUrl } as never,
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "service.created",
    entityType: "Service",
    entityId: service.id,
  });

  revalidatePath("/admin/services");
  redirect("/admin/services");
}

export async function updateServiceAction(id: string, _prevState: unknown, formData: FormData) {
  const { db, user } = await requireStaffContext();
  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description") || undefined,
    prepInstructions: formData.get("prepInstructions") || undefined,
    aftercareInstructions: formData.get("aftercareInstructions") || undefined,
    durationMinutes: formData.get("durationMinutes"),
    taxable: formData.get("taxable") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const priceCents = dollarsToCents(formData.get("price"));
  const active = formData.get("active") === "on";
  const imageUrl = String(formData.get("imageUrl") ?? "") || undefined;

  await db.service.updateMany({ where: { id }, data: { ...parsed.data, priceCents, active, imageUrl } });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "service.updated",
    entityType: "Service",
    entityId: id,
  });

  revalidatePath("/admin/services");
  revalidatePath(`/admin/services/${id}/edit`);
  redirect("/admin/services");
}

export async function archiveServiceAction(id: string) {
  const { db, user } = await requireStaffContext();
  await db.service.updateMany({ where: { id }, data: { active: false, archivedAt: new Date() } });
  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "service.archived",
    entityType: "Service",
    entityId: id,
  });
  revalidatePath("/admin/services");
}

// ---------------------------------------------------------------------------
// Product categories
// ---------------------------------------------------------------------------

export async function createProductCategoryAction(_prevState: unknown, formData: FormData) {
  const { db } = await requireStaffContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  await db.productCategory.create({ data: { name, sortOrder: 0 } as never });
  revalidatePath("/admin/products");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  categoryId: z.string().min(1, "Category is required"),
  description: z.string().max(2000).optional(),
  sku: z.string().min(1, "SKU is required").max(60),
  taxable: z.boolean().optional(),
  inventoryQuantity: z.coerce.number().int().min(0),
});

export async function createProductAction(_prevState: unknown, formData: FormData) {
  const { db, user } = await requireStaffContext();
  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description") || undefined,
    sku: formData.get("sku"),
    taxable: formData.get("taxable") === "on",
    inventoryQuantity: formData.get("inventoryQuantity") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const priceCents = dollarsToCents(formData.get("price"));
  const imageUrl = String(formData.get("imageUrl") ?? "") || undefined;

  const existingSku = await db.product.findFirst({ where: { sku: parsed.data.sku } });
  if (existingSku) return { error: "A product with this SKU already exists." };

  const product = await db.product.create({
    data: { ...parsed.data, priceCents, images: imageUrl ? [imageUrl] : undefined } as never,
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "product.created",
    entityType: "Product",
    entityId: product.id,
  });

  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function updateProductAction(id: string, _prevState: unknown, formData: FormData) {
  const { db, user } = await requireStaffContext();
  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description") || undefined,
    sku: formData.get("sku"),
    taxable: formData.get("taxable") === "on",
    inventoryQuantity: formData.get("inventoryQuantity") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const priceCents = dollarsToCents(formData.get("price"));
  const active = formData.get("active") === "on";
  const imageUrl = String(formData.get("imageUrl") ?? "") || undefined;

  await db.product.updateMany({
    where: { id },
    data: { ...parsed.data, priceCents, active, images: imageUrl ? [imageUrl] : undefined },
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "product.updated",
    entityType: "Product",
    entityId: id,
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}/edit`);
  redirect("/admin/products");
}

export async function archiveProductAction(id: string) {
  const { db, user } = await requireStaffContext();
  await db.product.updateMany({ where: { id }, data: { active: false, archivedAt: new Date() } });
  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "product.archived",
    entityType: "Product",
    entityId: id,
  });
  revalidatePath("/admin/products");
}

export async function adjustInventoryAction(_prevState: unknown, formData: FormData) {
  const { db, user } = await requireStaffContext();
  const productId = String(formData.get("productId") ?? "");
  const quantityChange = Number(formData.get("quantityChange") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!productId || !quantityChange) return { error: "Provide a product and a non-zero quantity." };
  if (!reason) return { error: "A reason is required for inventory adjustments." };

  const product = await db.product.findFirst({ where: { id: productId } });
  if (!product) return { error: "Product not found." };

  await db.$transaction([
    db.product.updateMany({
      where: { id: productId },
      data: { inventoryQuantity: { increment: quantityChange } },
    }),
    db.inventoryTransaction.create({
      data: {
        productId,
        type: "ADJUSTMENT",
        quantityChange,
        reason,
      } as never,
    }),
  ]);

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "product.inventory_adjusted",
    entityType: "Product",
    entityId: productId,
    reason,
    metadata: { quantityChange },
  });

  revalidatePath("/admin/products");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

const packageSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  description: z.string().max(2000).optional(),
  totalUses: z.coerce.number().int().min(1),
  expiryDays: z.coerce.number().int().min(1).optional(),
  transferable: z.boolean().optional(),
});

export async function createPackageAction(_prevState: unknown, formData: FormData) {
  const { db, user } = await requireStaffContext();
  const parsed = packageSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    totalUses: formData.get("totalUses"),
    expiryDays: formData.get("expiryDays") || undefined,
    transferable: formData.get("transferable") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const priceCents = dollarsToCents(formData.get("price"));
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  if (serviceIds.length === 0) return { error: "Select at least one service for this package." };

  const pkg = await db.package.create({ data: { ...parsed.data, priceCents } as never });
  await db.packageItem.createMany({
    data: serviceIds.map((serviceId) => ({ packageId: pkg.id, serviceId, quantity: 1 })),
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "package.created",
    entityType: "Package",
    entityId: pkg.id,
  });

  revalidatePath("/admin/packages");
  redirect("/admin/packages");
}

export async function archivePackageAction(id: string) {
  const { db, user } = await requireStaffContext();
  await db.package.updateMany({ where: { id }, data: { active: false, archivedAt: new Date() } });
  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "package.archived",
    entityType: "Package",
    entityId: id,
  });
  revalidatePath("/admin/packages");
}
