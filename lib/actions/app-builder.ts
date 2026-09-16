"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { rawDb } from "@/lib/db";
import {
  ActionError,
  formBool,
  formText,
  requireMerchantAction,
  runAction,
  type ActionResult,
  type MerchantRequirement,
} from "@/lib/merchant-action";
import type { TenantDb } from "@/lib/tenant-db";
import { pricingOptionsSchema, toStoredPricingOptions, EMPTY_PRICING } from "@/lib/pricing-options";

/**
 * Every create/edit/archive behind the App Builder tabs. Each action names the
 * clinic explicitly and is authorised by requireMerchantAction, so the clinic
 * owner, permitted staff, and an agency admin viewing the clinic all use the
 * same code path. Changes show up in the client app on its next request.
 */

export type ItemKind = "service" | "product" | "package" | "promotion" | "membershipPlan" | "reward" | "campaign";

const NEEDS: Record<ItemKind, MerchantRequirement> = {
  service: "catalog.manage",
  product: "catalog.manage",
  package: "catalog.manage",
  promotion: "promotions.create",
  membershipPlan: "memberships.manage",
  reward: "loyalty.adjust",
  campaign: "messages.send",
};

const LIVE_MEMBERSHIP = ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] as const;

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const toNumber = (v: unknown) =>
  v === undefined || v === null || v === "" ? undefined : Number(String(v).replace(",", "."));

const int = (label: string, min: number, max = 1_000_000) =>
  z.preprocess(
    toNumber,
    z
      .number({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` })
      .int("Use a whole number")
      .min(min, `Must be at least ${min}`)
      .max(max, `Must be at most ${max}`),
  );

const optionalInt = (label: string, min: number, max = 1_000_000) => int(label, min, max).optional();

/** Money typed as "49" or "49.50" (comma also accepted), stored as cents. */
const money = (label: string) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : String(v).replace(",", ".").trim()),
    z
      .string({ required_error: `Enter ${label}` })
      .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 49 or 49.50")
      .transform((s) => Math.round(Number(s) * 100)),
  );

const name = (label = "a name") =>
  z.string({ required_error: `Enter ${label}` }).min(1, `Enter ${label}`).max(120, "Keep it under 120 characters");

const longText = z.string().max(5000, "Keep it under 5000 characters").optional();

/**
 * Only URLs our own upload endpoint produced, or https URLs (S3/R2 public
 * buckets). Blocks javascript:, data: and plain-http URLs from ending up in an
 * <img src> rendered to every client.
 */
const imageUrlString = z
  .string()
  .max(2048)
  .refine((v) => v.startsWith("/uploads/") || /^https:\/\/[^\s"'<>]+$/.test(v), "Upload the image again");
const imageUrl = imageUrlString.optional();

const dateTime = (label: string) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : new Date(String(v))),
    z
      .date({ required_error: `Choose ${label}`, invalid_type_error: `Choose ${label}` })
      .refine((d) => !Number.isNaN(d.getTime()), `Choose ${label}`),
  );

const fieldError = (field: string, message: string) => new z.ZodError([{ code: "custom", path: [field], message }]);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function revalidateMerchant(merchantId: string) {
  const tenant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { slug: true } });
  revalidatePath(`/m/${merchantId}`, "layout");
  if (tenant) revalidatePath(`/app/${tenant.slug}`, "layout");
}

/** Maps a unique-constraint violation onto the field that caused it. */
function rethrowUnique(err: unknown, field: string, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw fieldError(field, message);
  throw err;
}

async function findOrCreateCategory(db: TenantDb, kind: "service" | "product", rawName: string): Promise<string> {
  const categoryName = rawName.trim();
  const where = { name: { equals: categoryName, mode: "insensitive" as const } };
  if (kind === "service") {
    const existing = await db.serviceCategory.findFirst({ where });
    if (existing) {
      if (!existing.active) await db.serviceCategory.updateMany({ where: { id: existing.id }, data: { active: true } });
      return existing.id;
    }
    return (await db.serviceCategory.create({ data: { name: categoryName } as never })).id;
  }
  const existing = await db.productCategory.findFirst({ where });
  if (existing) {
    if (!existing.active) await db.productCategory.updateMany({ where: { id: existing.id }, data: { active: true } });
    return existing.id;
  }
  return (await db.productCategory.create({ data: { name: categoryName } as never })).id;
}

function assertFound<T>(found: T | null | undefined): T {
  if (!found) throw new ActionError("That item no longer exists.");
  return found;
}

// ---------------------------------------------------------------------------
// Options the forms need (categories, services, products, tags)
// ---------------------------------------------------------------------------

export async function getAppBuilderOptionsAction(merchantId: string, kind: ItemKind) {
  return runAction(async () => {
    const { db } = await requireMerchantAction(merchantId, NEEDS[kind]);
    const [serviceCategories, productCategories, services, products, tags, staff] = await Promise.all([
      db.serviceCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
      db.productCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
      db.service.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.product.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.catalogTag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, icon: true, description: true } }),
      db.staffProfile.findMany({
        where: { active: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true, title: true },
      }),
    ]);
    return {
      serviceCategories: serviceCategories.map((c) => c.name),
      productCategories: productCategories.map((c) => c.name),
      services,
      products,
      tags,
      staff: staff.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), title: p.title })),
    };
  });
}

// ---------------------------------------------------------------------------
// Load one item for editing
// ---------------------------------------------------------------------------

export async function getAppBuilderItemAction(merchantId: string, kind: ItemKind, id: string) {
  return runAction(async () => {
    const { db } = await requireMerchantAction(merchantId, NEEDS[kind]);
    let item: object | null = null;
    switch (kind) {
      case "service":
        item = await db.service.findFirst({ where: { id }, include: SHOP_ITEM_INCLUDE });
        break;
      case "product":
        item = await db.product.findFirst({ where: { id }, include: SHOP_ITEM_INCLUDE });
        break;
      case "package":
        item = await db.package.findFirst({ where: { id }, include: { items: { select: { serviceId: true } } } });
        break;
      case "promotion":
        item = await db.promotion.findFirst({ where: { id } });
        break;
      case "membershipPlan": {
        const plan = await db.membershipPlan.findFirst({ where: { id }, include: { benefits: { select: { description: true } } } });
        if (plan) {
          const activeMembers = await db.customerMembership.count({ where: { membershipPlanId: id, status: { in: [...LIVE_MEMBERSHIP] } } });
          item = { ...plan, activeMembers };
        }
        break;
      }
      case "reward":
        item = await db.loyaltyReward.findFirst({ where: { id } });
        break;
      case "campaign":
        item = await db.notificationCampaign.findFirst({ where: { id } });
        break;
    }
    // Dates cross the server/client boundary as ISO strings.
    return { item: JSON.parse(JSON.stringify(assertFound(item))) as Record<string, unknown> };
  });
}

// ---------------------------------------------------------------------------
// Fields shared by everything a clinic sells in its shop
//
// All of them are optional: the clinic decides what its product page shows —
// what to call a unit, how long it takes, who performs it, what clients should
// know before and after, what past clients looked like, and whether buying it
// needs a word with the clinic first.
// ---------------------------------------------------------------------------

const shortText = z.string().max(160, "Keep it under 160 characters").optional();

/** JSON carried in one hidden field, because the clinic edits a whole list at once. */
const jsonField = <T extends z.ZodTypeAny>(schema: T, fallback: z.infer<T>) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }, schema);

const tagInputSchema = z.object({
  id: z.string().max(40).optional(),
  name: name("a tag name"),
  icon: z.string().max(40).optional(),
  description: shortText,
});

const clientResultSchema = z
  .object({
    beforeImageUrl: imageUrl,
    afterImageUrl: imageUrl,
    testimonial: longText,
  })
  // A row with nothing in it is dropped rather than saved as an empty result.
  .refine((r) => r.beforeImageUrl || r.afterImageUrl || r.testimonial, { message: "Add a photo or a testimonial" });

const shopItemSchema = z.object({
  unitLabel: shortText,
  schedulingUrl: z
    .string()
    .max(2048)
    .refine((v) => /^https?:\/\/[^\s"'<>]+$/.test(v), "Enter a link starting with https://")
    .optional(),
  maxQuantity: optionalInt("a maximum quantity", 1, 10_000),
  requiresConsultation: z.boolean(),
  consultationNotice: longText,
  cashBalanceBlocked: z.boolean(),
  practitionerId: z.string().max(40).optional(),
  pricingOptions: jsonField(pricingOptionsSchema, EMPTY_PRICING),
  tags: jsonField(z.array(tagInputSchema).max(12, "Up to 12 tags"), []),
  clientResults: jsonField(z.array(clientResultSchema).max(20, "Up to 20 results"), []),
});

type ShopItemInput = z.infer<typeof shopItemSchema>;

function readShopItemFields(fd: FormData): ShopItemInput {
  return shopItemSchema.parse({
    unitLabel: formText(fd, "unitLabel"),
    schedulingUrl: formText(fd, "schedulingUrl"),
    maxQuantity: formText(fd, "maxQuantity"),
    requiresConsultation: formBool(fd, "requiresConsultation"),
    consultationNotice: formText(fd, "consultationNotice"),
    cashBalanceBlocked: formBool(fd, "cashBalanceBlocked"),
    practitionerId: formText(fd, "practitionerId"),
    pricingOptions: formText(fd, "pricingOptions"),
    tags: formText(fd, "tags"),
    clientResults: formText(fd, "clientResults"),
  });
}

/** The columns on the item itself; tags and results are saved after it exists. */
async function shopItemColumns(db: TenantDb, data: ShopItemInput) {
  let practitionerId: string | null = null;
  if (data.practitionerId) {
    // Scoped lookup: a staff id from another clinic simply doesn't resolve.
    const staff = await db.staffProfile.findFirst({ where: { id: data.practitionerId }, select: { id: true } });
    if (!staff) throw fieldError("practitionerId", "That team member no longer works here.");
    practitionerId = staff.id;
  }
  return {
    unitLabel: data.unitLabel ?? null,
    schedulingUrl: data.schedulingUrl ?? null,
    maxQuantity: data.maxQuantity ?? null,
    requiresConsultation: data.requiresConsultation,
    consultationNotice: data.consultationNotice ?? null,
    cashBalanceBlocked: data.cashBalanceBlocked,
    practitionerId,
    pricingOptions: toStoredPricingOptions(data.pricingOptions) ?? Prisma.DbNull,
  };
}

/**
 * Tags and client results are replaced wholesale, so what is saved is exactly
 * what the clinic sees in the form. A tag the clinic typed is created once and
 * then shared by every item that uses it.
 */
async function saveTagsAndResults(db: TenantDb, kind: "service" | "product", itemId: string, data: ShopItemInput) {
  const link = kind === "service" ? { serviceId: itemId } : { productId: itemId };

  const tagIds: string[] = [];
  for (const tag of data.tags) {
    const existing = await db.catalogTag.findFirst({ where: { name: { equals: tag.name, mode: "insensitive" } } });
    let tagId: string;
    if (existing) {
      await db.catalogTag.updateMany({
        where: { id: existing.id },
        data: { icon: tag.icon ?? existing.icon, description: tag.description ?? existing.description },
      });
      tagId = existing.id;
    } else {
      tagId = (await db.catalogTag.create({ data: { name: tag.name, icon: tag.icon ?? "sparkle", description: tag.description ?? null } as never })).id;
    }
    if (!tagIds.includes(tagId)) tagIds.push(tagId);
  }
  await db.catalogItemTag.deleteMany({ where: link });
  for (const tagId of tagIds) await db.catalogItemTag.create({ data: { tagId, ...link } as never });

  await db.clientResult.deleteMany({ where: link });
  for (const [index, result] of data.clientResults.entries()) {
    await db.clientResult.create({
      data: {
        ...link,
        beforeImageUrl: result.beforeImageUrl ?? null,
        afterImageUrl: result.afterImageUrl ?? null,
        testimonial: result.testimonial ?? null,
        sortOrder: index,
      } as never,
    });
  }
}

const SHOP_ITEM_INCLUDE = {
  category: { select: { name: true } },
  itemTags: { include: { tag: true } },
  clientResults: { orderBy: { sortOrder: "asc" as const } },
} as const;

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const serviceSchema = z.object({
  name: name(),
  categoryName: name("a category"),
  description: longText,
  prepInstructions: longText,
  aftercareInstructions: longText,
  durationMinutes: optionalInt("a duration", 1, 24 * 60),
  priceCents: money("a price"),
  imageUrl,
  taxable: z.boolean(),
  active: z.boolean(),
});

export async function saveServiceAction(merchantId: string, id: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS.service);
    const data = serviceSchema.parse({
      name: formText(fd, "name"),
      // A clinic that never thinks about categories still gets a working shop.
      categoryName: formText(fd, "categoryName") ?? "General",
      description: formText(fd, "description"),
      prepInstructions: formText(fd, "prepInstructions"),
      aftercareInstructions: formText(fd, "aftercareInstructions"),
      durationMinutes: formText(fd, "durationMinutes"),
      priceCents: formText(fd, "price"),
      imageUrl: formText(fd, "imageUrl"),
      taxable: formBool(fd, "taxable"),
      active: formBool(fd, "active"),
    });
    const shared = readShopItemFields(fd);
    const { categoryName, ...fields } = data;
    const values = {
      ...fields,
      ...(await shopItemColumns(ctx.db, shared)),
      categoryId: await findOrCreateCategory(ctx.db, "service", categoryName),
      description: fields.description ?? null,
      prepInstructions: fields.prepInstructions ?? null,
      aftercareInstructions: fields.aftercareInstructions ?? null,
      imageUrl: fields.imageUrl ?? null,
      // Something sold without a duration can still be bought, just not booked
      // into the calendar, so it keeps a nominal length.
      durationMinutes: fields.durationMinutes ?? 30,
    };

    let savedId: string;
    if (id) {
      assertFound(await ctx.db.service.findFirst({ where: { id, archivedAt: null } }));
      await ctx.db.service.updateMany({ where: { id }, data: values });
      savedId = id;
    } else {
      savedId = (await ctx.db.service.create({ data: values as never })).id;
    }
    await saveTagsAndResults(ctx.db, "service", savedId, shared);
    await ctx.audit(id ? "service.updated" : "service.created", "Service", savedId, { name: data.name });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productSchema = z.object({
  name: name(),
  categoryName: name("a category"),
  description: longText,
  durationMinutes: optionalInt("a duration", 1, 24 * 60),
  prepInstructions: longText,
  aftercareInstructions: longText,
  priceCents: money("a price"),
  sku: z
    .string()
    .max(64, "Keep the SKU under 64 characters")
    .regex(/^[A-Za-z0-9._-]+$/, "Letters, numbers, dots, dashes and underscores only")
    .optional(),
  inventoryQuantity: int("the stock level", 0),
  images: z.array(imageUrlString).max(6, "Up to 6 images"),
  taxable: z.boolean(),
  active: z.boolean(),
});

export async function saveProductAction(merchantId: string, id: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS.product);
    const data = productSchema.parse({
      name: formText(fd, "name"),
      // A clinic that never thinks about categories still gets a working shop.
      categoryName: formText(fd, "categoryName") ?? "General",
      description: formText(fd, "description"),
      durationMinutes: formText(fd, "durationMinutes"),
      prepInstructions: formText(fd, "prepInstructions"),
      aftercareInstructions: formText(fd, "aftercareInstructions"),
      priceCents: formText(fd, "price"),
      sku: formText(fd, "sku"),
      inventoryQuantity: formText(fd, "inventoryQuantity") ?? "0",
      images: fd.getAll("images").map(String).filter(Boolean),
      taxable: formBool(fd, "taxable"),
      active: formBool(fd, "active"),
    });
    const shared = readShopItemFields(fd);
    const { categoryName, sku, ...rest } = data;
    const fields = {
      ...rest,
      ...(await shopItemColumns(ctx.db, shared)),
      durationMinutes: rest.durationMinutes ?? null,
      prepInstructions: rest.prepInstructions ?? null,
      aftercareInstructions: rest.aftercareInstructions ?? null,
    };
    const categoryId = await findOrCreateCategory(ctx.db, "product", categoryName);

    let savedId: string;
    try {
      if (id) {
        const existing = assertFound(await ctx.db.product.findFirst({ where: { id, archivedAt: null } }));
        await ctx.db.product.updateMany({
          where: { id },
          data: { ...fields, categoryId, description: fields.description ?? null, sku: sku ?? existing.sku },
        });
        // Keep the stock ledger honest: a manual stock change is a movement.
        const delta = fields.inventoryQuantity - existing.inventoryQuantity;
        if (delta !== 0) {
          await ctx.db.inventoryTransaction.create({
            data: { productId: id, type: "ADJUSTMENT", quantityChange: delta, reason: "Stock set in App Builder" } as never,
          });
        }
        savedId = id;
      } else {
        savedId = (
          await ctx.db.product.create({
            data: {
              ...fields,
              categoryId,
              description: fields.description ?? null,
              sku: sku ?? `SKU-${nanoid(10).toUpperCase().replace(/[^A-Z0-9]/g, "0")}`,
            } as never,
          })
        ).id;
        if (fields.inventoryQuantity > 0) {
          await ctx.db.inventoryTransaction.create({
            data: { productId: savedId, type: "ADJUSTMENT", quantityChange: fields.inventoryQuantity, reason: "Opening stock" } as never,
          });
        }
      }
    } catch (err) {
      rethrowUnique(err, "sku", "Another product already uses this SKU");
    }
    await saveTagsAndResults(ctx.db, "product", savedId, shared);
    await ctx.audit(id ? "product.updated" : "product.created", "Product", savedId, { name: data.name });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

// ---------------------------------------------------------------------------
// Custom plans (packages)
// ---------------------------------------------------------------------------

const packageSchema = z.object({
  name: name(),
  description: longText,
  priceCents: money("a price"),
  totalUses: int("the number of sessions", 1, 1000),
  expiryDays: optionalInt("an expiry", 1, 3650),
  transferable: z.boolean(),
  imageUrl,
  active: z.boolean(),
  serviceIds: z.array(z.string().min(1)).min(1, "Choose at least one treatment"),
});

export async function savePackageAction(merchantId: string, id: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS.package);
    const data = packageSchema.parse({
      name: formText(fd, "name"),
      description: formText(fd, "description"),
      priceCents: formText(fd, "price"),
      totalUses: formText(fd, "totalUses"),
      expiryDays: formText(fd, "expiryDays"),
      transferable: formBool(fd, "transferable"),
      imageUrl: formText(fd, "imageUrl"),
      active: formBool(fd, "active"),
      serviceIds: [...new Set(fd.getAll("serviceIds").map(String).filter(Boolean))],
    });

    // Treatments must belong to this clinic.
    const owned = await ctx.db.service.count({ where: { id: { in: data.serviceIds }, archivedAt: null } });
    if (owned !== data.serviceIds.length) throw fieldError("serviceIds", "Choose treatments from this clinic");

    const { serviceIds, ...fields } = data;
    const values = {
      ...fields,
      description: fields.description ?? null,
      imageUrl: fields.imageUrl ?? null,
      expiryDays: fields.expiryDays ?? null,
    };

    let savedId: string;
    if (id) {
      assertFound(await ctx.db.package.findFirst({ where: { id, archivedAt: null } }));
      await ctx.db.package.updateMany({ where: { id }, data: values });
      savedId = id;
      // PackageItem has no tenant column; the package it hangs off was tenant-checked above.
      await rawDb.packageItem.deleteMany({ where: { packageId: id } });
    } else {
      savedId = (await ctx.db.package.create({ data: values as never })).id;
    }
    await rawDb.packageItem.createMany({ data: serviceIds.map((serviceId) => ({ packageId: savedId, serviceId, quantity: 1 })) });

    await ctx.audit(id ? "package.updated" : "package.created", "Package", savedId, { name: data.name });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

// ---------------------------------------------------------------------------
// Offers (promotions)
// ---------------------------------------------------------------------------

const promotionSchema = z
  .object({
    title: name("a title"),
    description: longText,
    imageUrl,
    startAt: dateTime("a start date"),
    endAt: dateTime("an end date"),
    discountType: z.enum(["PERCENT", "FIXED_AMOUNT"], { errorMap: () => ({ message: "Choose a discount type" }) }),
    discountValue: z.preprocess(
      toNumber,
      z.number({ invalid_type_error: "Enter a discount", required_error: "Enter a discount" }).positive("Enter a discount"),
    ),
    code: z
      .string()
      .max(32, "Keep the code under 32 characters")
      .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only")
      .transform((c) => c.toUpperCase())
      .optional(),
    usageLimit: optionalInt("a usage limit", 1),
    perCustomerLimit: optionalInt("a per-client limit", 1),
    appOnly: z.boolean(),
    customerSegment: z.enum(["ALL", "NEW", "MEMBERS", "NON_MEMBERS", "TAGGED"]),
    segmentTagId: z.string().optional(),
    active: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.endAt <= p.startAt) ctx.addIssue({ code: "custom", path: ["endAt"], message: "End must be after the start" });
    if (p.discountType === "PERCENT" && (p.discountValue > 100 || !Number.isInteger(p.discountValue)))
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A whole percentage from 1 to 100" });
    if (p.discountType === "FIXED_AMOUNT" && !/^\d+(\.\d{1,2})?$/.test(String(p.discountValue)))
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter an amount like 10 or 10.50" });
    if (p.customerSegment === "TAGGED" && !p.segmentTagId) ctx.addIssue({ code: "custom", path: ["segmentTagId"], message: "Choose a tag" });
  });

export async function savePromotionAction(merchantId: string, id: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS.promotion);
    const data = promotionSchema.parse({
      title: formText(fd, "title"),
      description: formText(fd, "description"),
      imageUrl: formText(fd, "imageUrl"),
      startAt: formText(fd, "startAt"),
      endAt: formText(fd, "endAt"),
      discountType: formText(fd, "discountType"),
      discountValue: formText(fd, "discountValue"),
      code: formText(fd, "code"),
      usageLimit: formText(fd, "usageLimit"),
      perCustomerLimit: formText(fd, "perCustomerLimit"),
      appOnly: formBool(fd, "appOnly"),
      customerSegment: formText(fd, "customerSegment") ?? "ALL",
      segmentTagId: formText(fd, "segmentTagId"),
      active: formBool(fd, "active"),
    });

    const tagged = data.customerSegment === "TAGGED";
    if (tagged && !(await ctx.db.customerTag.findFirst({ where: { id: data.segmentTagId } }))) throw fieldError("segmentTagId", "Choose a tag");

    const values = {
      ...data,
      // Fixed amounts are typed in currency units and stored in cents.
      discountValue: data.discountType === "FIXED_AMOUNT" ? Math.round(data.discountValue * 100) : data.discountValue,
      description: data.description ?? null,
      imageUrl: data.imageUrl ?? null,
      code: data.code ?? null,
      usageLimit: data.usageLimit ?? null,
      perCustomerLimit: data.perCustomerLimit ?? null,
      segmentTagId: tagged ? (data.segmentTagId ?? null) : null,
    };

    let savedId: string;
    try {
      if (id) {
        assertFound(await ctx.db.promotion.findFirst({ where: { id } }));
        await ctx.db.promotion.updateMany({ where: { id }, data: values });
        savedId = id;
      } else {
        savedId = (await ctx.db.promotion.create({ data: values as never })).id;
      }
    } catch (err) {
      rethrowUnique(err, "code", "Another offer already uses this code");
    }
    await ctx.audit(id ? "promotion.updated" : "promotion.created", "Promotion", savedId, { title: data.title });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

// ---------------------------------------------------------------------------
// Membership plans
// ---------------------------------------------------------------------------

const planSchema = z.object({
  name: name(),
  description: longText,
  billingFrequency: z.enum(["MONTHLY", "ANNUAL"]),
  priceCents: money("a price"),
  includedCreditCents: money("included credit").optional(),
  serviceDiscountPercent: optionalInt("a treatment discount", 1, 100),
  productDiscountPercent: optionalInt("a product discount", 1, 100),
  priorityAccess: z.boolean(),
  minimumCommitmentMonths: optionalInt("a minimum term", 1, 60),
  cancellationPolicy: longText,
  pauseAllowed: z.boolean(),
  maxPauseMonths: optionalInt("a pause limit", 1, 12),
  active: z.boolean(),
  benefits: z
    .array(z.string().min(1).max(200, "Keep each benefit under 200 characters"))
    .max(20, "Up to 20 benefits"),
});

export async function saveMembershipPlanAction(
  merchantId: string,
  id: string | null,
  fd: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS.membershipPlan);
    const data = planSchema.parse({
      name: formText(fd, "name"),
      description: formText(fd, "description"),
      billingFrequency: formText(fd, "billingFrequency") ?? "MONTHLY",
      priceCents: formText(fd, "price"),
      includedCreditCents: formText(fd, "includedCredit"),
      serviceDiscountPercent: formText(fd, "serviceDiscountPercent"),
      productDiscountPercent: formText(fd, "productDiscountPercent"),
      priorityAccess: formBool(fd, "priorityAccess"),
      minimumCommitmentMonths: formText(fd, "minimumCommitmentMonths"),
      cancellationPolicy: formText(fd, "cancellationPolicy"),
      pauseAllowed: formBool(fd, "pauseAllowed"),
      maxPauseMonths: formText(fd, "maxPauseMonths"),
      active: formBool(fd, "active"),
      benefits: (formText(fd, "benefits") ?? "")
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean),
    });

    const { benefits, ...fields } = data;
    const values = {
      ...fields,
      includedCreditCents: fields.includedCreditCents ?? 0,
      description: fields.description ?? null,
      serviceDiscountPercent: fields.serviceDiscountPercent ?? null,
      productDiscountPercent: fields.productDiscountPercent ?? null,
      minimumCommitmentMonths: fields.minimumCommitmentMonths ?? null,
      cancellationPolicy: fields.cancellationPolicy ?? null,
      maxPauseMonths: fields.pauseAllowed ? (fields.maxPauseMonths ?? null) : null,
    };

    let savedId: string;
    if (id) {
      const existing = assertFound(await ctx.db.membershipPlan.findFirst({ where: { id, archivedAt: null } }));
      // Members agreed to a price. Changing it underneath them — and, once
      // Stripe is connected, underneath their subscriptions — is not an edit.
      const members = await ctx.db.customerMembership.count({ where: { membershipPlanId: id, status: { in: [...LIVE_MEMBERSHIP] } } });
      if (members > 0 && (existing.priceCents !== values.priceCents || existing.billingFrequency !== values.billingFrequency)) {
        throw fieldError(
          "price",
          `${members} client${members === 1 ? " is" : "s are"} on this plan. Create a new plan for a different price, then hide this one.`,
        );
      }
      await ctx.db.membershipPlan.updateMany({ where: { id }, data: values });
      savedId = id;
      await rawDb.membershipBenefit.deleteMany({ where: { membershipPlanId: id } });
    } else {
      savedId = (await ctx.db.membershipPlan.create({ data: values as never })).id;
    }
    if (benefits.length) {
      await rawDb.membershipBenefit.createMany({
        data: benefits.map((description) => ({ membershipPlanId: savedId, type: "OTHER" as const, description })),
      });
    }

    await ctx.audit(id ? "membership_plan.updated" : "membership_plan.created", "MembershipPlan", savedId, { name: data.name });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

const rewardSchema = z
  .object({
    name: name(),
    description: longText,
    pointsCost: int("a points cost", 1, 10_000_000),
    rewardType: z.enum(["DISCOUNT_PERCENT", "DISCOUNT_AMOUNT", "FREE_SERVICE", "FREE_PRODUCT"], {
      errorMap: () => ({ message: "Choose a reward type" }),
    }),
    discountPercent: optionalInt("a percentage", 1, 100),
    discountAmountCents: money("an amount").optional(),
    serviceId: z.string().optional(),
    productId: z.string().optional(),
    active: z.boolean(),
  })
  .superRefine((r, ctx) => {
    if (r.rewardType === "DISCOUNT_PERCENT" && !r.discountPercent)
      ctx.addIssue({ code: "custom", path: ["discountPercent"], message: "Enter a percentage" });
    if (r.rewardType === "DISCOUNT_AMOUNT" && !r.discountAmountCents)
      ctx.addIssue({ code: "custom", path: ["discountAmount"], message: "Enter an amount" });
    if (r.rewardType === "FREE_SERVICE" && !r.serviceId) ctx.addIssue({ code: "custom", path: ["serviceId"], message: "Choose a treatment" });
    if (r.rewardType === "FREE_PRODUCT" && !r.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose a product" });
  });

export async function saveRewardAction(merchantId: string, id: string | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS.reward);
    const data = rewardSchema.parse({
      name: formText(fd, "name"),
      description: formText(fd, "description"),
      pointsCost: formText(fd, "pointsCost"),
      rewardType: formText(fd, "rewardType"),
      discountPercent: formText(fd, "discountPercent"),
      discountAmountCents: formText(fd, "discountAmount"),
      serviceId: formText(fd, "serviceId"),
      productId: formText(fd, "productId"),
      active: formBool(fd, "active"),
    });

    // Keep only the fields for the chosen type; linked items must be this clinic's.
    const values = {
      name: data.name,
      description: data.description ?? null,
      pointsCost: data.pointsCost,
      rewardType: data.rewardType,
      active: data.active,
      discountPercent: data.rewardType === "DISCOUNT_PERCENT" ? (data.discountPercent ?? null) : null,
      discountAmountCents: data.rewardType === "DISCOUNT_AMOUNT" ? (data.discountAmountCents ?? null) : null,
      serviceId: data.rewardType === "FREE_SERVICE" ? (data.serviceId ?? null) : null,
      productId: data.rewardType === "FREE_PRODUCT" ? (data.productId ?? null) : null,
    };
    if (values.serviceId && !(await ctx.db.service.findFirst({ where: { id: values.serviceId } })))
      throw fieldError("serviceId", "Choose a treatment");
    if (values.productId && !(await ctx.db.product.findFirst({ where: { id: values.productId } })))
      throw fieldError("productId", "Choose a product");

    let savedId: string;
    if (id) {
      assertFound(await ctx.db.loyaltyReward.findFirst({ where: { id } }));
      await ctx.db.loyaltyReward.updateMany({ where: { id }, data: values });
      savedId = id;
    } else {
      // A clinic that never configured loyalty still gets a programme to hang rewards on.
      const programme =
        (await ctx.db.loyaltyProgramme.findFirst({ where: {} })) ?? (await ctx.db.loyaltyProgramme.create({ data: {} as never }));
      savedId = (await ctx.db.loyaltyReward.create({ data: { ...values, loyaltyProgrammeId: programme.id } as never })).id;
    }
    await ctx.audit(id ? "reward.updated" : "reward.created", "LoyaltyReward", savedId, { name: data.name });
    await revalidateMerchant(merchantId);
    return { id: savedId };
  });
}

// ---------------------------------------------------------------------------
// Visibility and archiving, for every kind
// ---------------------------------------------------------------------------

/** Shows or hides an item in the client app without deleting anything. */
export async function setItemActiveAction(merchantId: string, kind: ItemKind, id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS[kind]);
    const where = { id };
    const data = { active };
    let count: number;
    switch (kind) {
      case "service":
        ({ count } = await ctx.db.service.updateMany({ where, data }));
        break;
      case "product":
        ({ count } = await ctx.db.product.updateMany({ where, data }));
        break;
      case "package":
        ({ count } = await ctx.db.package.updateMany({ where, data }));
        break;
      case "promotion":
        ({ count } = await ctx.db.promotion.updateMany({ where, data }));
        break;
      case "membershipPlan":
        ({ count } = await ctx.db.membershipPlan.updateMany({ where, data }));
        break;
      case "reward":
        ({ count } = await ctx.db.loyaltyReward.updateMany({ where, data }));
        break;
      case "campaign":
        throw new ActionError("Campaigns are sent or deleted, not hidden.");
    }
    if (count === 0) throw new ActionError("That item no longer exists.");
    await ctx.audit(`${kind}.${active ? "shown" : "hidden"}`, kind, id);
    await revalidateMerchant(merchantId);
    return {};
  });
}

/**
 * Removes an item from App Builder and the client app. History that points at
 * it — past orders, redemptions, memberships — is kept, so anything that may
 * be referenced is archived rather than deleted.
 */
export async function archiveItemAction(merchantId: string, kind: ItemKind, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, NEEDS[kind]);
    const archived = { active: false, archivedAt: new Date() };
    const where = { id };
    let count = 0;
    switch (kind) {
      case "service":
        ({ count } = await ctx.db.service.updateMany({ where, data: archived }));
        break;
      case "product":
        ({ count } = await ctx.db.product.updateMany({ where, data: archived }));
        break;
      case "package":
        ({ count } = await ctx.db.package.updateMany({ where, data: archived }));
        break;
      case "membershipPlan": {
        const members = await ctx.db.customerMembership.count({ where: { membershipPlanId: id, status: { in: [...LIVE_MEMBERSHIP] } } });
        if (members > 0) {
          throw new ActionError(
            `${members} client${members === 1 ? " is" : "s are"} still on this plan. Hide it instead, so no one new can join.`,
          );
        }
        ({ count } = await ctx.db.membershipPlan.updateMany({ where, data: archived }));
        break;
      }
      case "promotion": {
        const used = await ctx.db.promotionRedemption.count({ where: { promotionId: id } });
        ({ count } = used
          ? await ctx.db.promotion.updateMany({ where, data: { active: false } })
          : await ctx.db.promotion.deleteMany({ where }));
        break;
      }
      case "reward":
        // Redemptions reference rewards in the loyalty ledger, so a reward is only ever hidden.
        ({ count } = await ctx.db.loyaltyReward.updateMany({ where, data: { active: false } }));
        break;
      case "campaign": {
        const campaign = await ctx.db.notificationCampaign.findFirst({ where });
        if (campaign && campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
          throw new ActionError("A sent campaign stays in the history.");
        }
        ({ count } = await ctx.db.notificationCampaign.deleteMany({ where }));
        break;
      }
    }
    if (count === 0) throw new ActionError("That item no longer exists.");
    await ctx.audit(`${kind}.archived`, kind, id);
    await revalidateMerchant(merchantId);
    return {};
  });
}
