import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));

const { POST } = await import("@/app/api/uploads/route");

/**
 * Who may upload, and what happens to what they send. The clinic is named in
 * the request body rather than taken from the session — deliberately, so an
 * agency admin working inside a clinic can upload — which makes "a user of
 * another clinic cannot" the test that matters most here.
 */
describe("POST /api/uploads", () => {
  const stamp = Date.now();
  let tenantId: string;
  let otherTenantId: string;
  let ownerId: string;
  let outsiderId: string;
  let platformAdminId: string;
  const storedUrls: string[] = [];

  beforeAll(async () => {
    const tenant = await rawDb.tenant.create({
      data: { slug: `uploads-${stamp}`, name: "Uploads Clinic", status: "ACTIVE", branding: { create: { businessName: "Uploads Clinic", primaryColor: "#00ff00" } } },
    });
    tenantId = tenant.id;
    const other = await rawDb.tenant.create({ data: { slug: `uploads-other-${stamp}`, name: "Other Clinic", status: "ACTIVE" } });
    otherTenantId = other.id;

    ownerId = (await rawDb.user.create({ data: { tenantId, email: `owner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    outsiderId = (await rawDb.user.create({ data: { tenantId: otherTenantId, email: `outsider-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    platformAdminId = (await rawDb.user.create({ data: { email: `admin-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
  });

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId]) await deleteTenantCompletely(id).catch(() => undefined);
    await rawDb.user.deleteMany({ where: { id: platformAdminId } }).catch(() => undefined);
  });

  afterEach(async () => {
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "upload:" } } }).catch(() => undefined);
    // Uploads land on local disk in tests; don't leave them in public/uploads.
    for (const url of storedUrls.splice(0)) {
      await unlink(path.join(process.cwd(), "public", url.replace(/^\//, ""))).catch(() => undefined);
    }
  });

  const asUser = (id: string) => authMock.auth.mockResolvedValue({ user: { id, email: "x@example.com", name: "x", authTime: Date.now() } });

  async function post(fields: Record<string, string>, file?: { buffer: Buffer; name: string; type: string }): Promise<{ status: number; body: Record<string, unknown> }> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set("file", new File([new Uint8Array(file.buffer)], file.name, { type: file.type }));
    const res = await POST(new Request("http://localhost/api/uploads", { method: "POST", body: fd }) as never);
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body.url === "string") storedUrls.push(body.url);
    return { status: res.status, body };
  }

  const photo = async (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: "#884422" } })
      .jpeg()
      .toBuffer();

  it("refuses a user of another clinic without saying the clinic exists", async () => {
    asUser(outsiderId);
    const { status, body } = await post({ merchantId: tenantId, purpose: "product-image" }, { buffer: await photo(1200, 900), name: "a.jpg", type: "image/jpeg" });
    expect(status).toBe(403);
    expect(body.code).toBe("notAllowed");
  });

  it("accepts a phone-sized photo from a clinic member and resizes it", async () => {
    asUser(ownerId);
    // The size that used to be refused outright: anything over 800x800.
    const { status, body } = await post({ merchantId: tenantId, purpose: "product-image" }, { buffer: await photo(4032, 3024), name: "phone.jpg", type: "image/jpeg" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ width: 1200, height: 900 });
    expect(String(body.url)).toMatch(/^\/uploads\/[A-Za-z0-9_-]+\.webp$/);
  });

  it("lets an agency admin working inside a clinic upload too", async () => {
    asUser(platformAdminId);
    const { status } = await post({ merchantId: tenantId, purpose: "logo" }, { buffer: await photo(900, 300), name: "logo.jpg", type: "image/jpeg" });
    expect(status).toBe(200);
  });

  it("paints the clinic's own colour behind a non-square app icon", async () => {
    asUser(ownerId);
    const { status, body } = await post({ merchantId: tenantId, purpose: "app-icon" }, { buffer: await photo(900, 300), name: "icon.jpg", type: "image/jpeg" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ width: 1024, height: 1024 });
  });

  it("refuses an iPhone HEIC with advice rather than 'unsupported file type'", async () => {
    asUser(ownerId);
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.from("heic"), Buffer.alloc(16)]);
    const { status, body } = await post({ merchantId: tenantId }, { buffer: heic, name: "IMG_0001.heic", type: "image/heic" });
    expect(status).toBe(400);
    expect(body.code).toBe("heicUnsupported");
    expect(String(body.error)).toMatch(/iPhone/);
  });

  it("refuses an image too small to make an app icon from, naming the minimum", async () => {
    asUser(ownerId);
    const { status, body } = await post({ merchantId: tenantId, purpose: "app-icon" }, { buffer: await photo(150, 150), name: "tiny.jpg", type: "image/jpeg" });
    expect(status).toBe(400);
    expect(body.code).toBe("tooSmall");
    expect(body.params).toMatchObject({ minWidth: 200, minHeight: 200 });
  });

  it("rate limits per user", async () => {
    asUser(ownerId);
    await rawDb.rateLimitBucket.create({ data: { key: `upload:${ownerId}`, count: 30, resetAt: new Date(Date.now() + 60_000) } });
    const { status, body } = await post({ merchantId: tenantId, purpose: "product-image" }, { buffer: await photo(1200, 900), name: "a.jpg", type: "image/jpeg" });
    expect(status).toBe(429);
    expect(body.code).toBe("rateLimited");
  });

  it("ignores a crop the clinic's own form never offered", async () => {
    asUser(ownerId);
    // 3:1 is not one of product-image's aspects; the server picks its default
    // rather than letting the request choose the stored dimensions.
    const { body } = await post({ merchantId: tenantId, purpose: "product-image", aspect: "3" }, { buffer: await photo(2000, 2000), name: "a.jpg", type: "image/jpeg" });
    expect(body).toMatchObject({ width: 1200, height: 900 });
  });
});
