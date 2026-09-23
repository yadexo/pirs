import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { searchListedClinics } from "@/lib/clinic-directory";

const manifestRoute = await import("@/app/app/[merchantSlug]/manifest.webmanifest/route");
const iconRoute = await import("@/app/app/[merchantSlug]/app-icon/[file]/route");

describe("find your clinic + installable clinic app", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  const slug = (s: string) => `${s}-${stamp}`;

  beforeAll(async () => {
    const make = async (s: string, name: string, opts: { listed: boolean; status?: "ACTIVE" | "SUSPENDED"; city?: string }) => {
      const t = await rawDb.tenant.create({ data: { slug: slug(s), name, status: opts.status ?? "ACTIVE" } });
      ids.push(t.id);
      await rawDb.tenantBranding.create({ data: { tenantId: t.id, businessName: name, city: opts.city ?? null } });
      await rawDb.tenantSettings.create({ data: { tenantId: t.id, publiclyListed: opts.listed } });
    };
    await make("pwa-listed", `Zephyr Listed ${stamp}`, { listed: true, city: "Utrecht" });
    await make("pwa-hidden", `Zephyr Hidden ${stamp}`, { listed: false });
    await make("pwa-suspended", `Zephyr Suspended ${stamp}`, { listed: true, status: "SUSPENDED" });
  });

  afterAll(async () => {
    for (const id of ids) await deleteTenantCompletely(id);
  });

  it("finds a clinic by its address as well as its name", async () => {
    const results = await searchListedClinics(slug("pwa-listed"));
    expect(results.map((r) => r.slug)).toEqual([slug("pwa-listed")]);
  });

  it("lists a clinic that never touched the setting — new clinics are findable", async () => {
    const t = await rawDb.tenant.create({ data: { slug: slug("pwa-default"), name: `Aurora Default ${stamp}` } });
    ids.push(t.id);
    await rawDb.tenantBranding.create({ data: { tenantId: t.id, businessName: `Aurora Default ${stamp}` } });
    // No publiclyListed given: it takes the default.
    await rawDb.tenantSettings.create({ data: { tenantId: t.id } });
    const results = await searchListedClinics(`Aurora Default ${stamp}`);
    expect(results.map((r) => r.slug)).toEqual([slug("pwa-default")]);
  });

  it("search finds only active clinics that opted in", async () => {
    const results = await searchListedClinics(`zephyr ${stamp}`);
    expect(results.map((r) => r.slug)).toEqual([slug("pwa-listed")]);
    expect(results[0]).toMatchObject({ city: "Utrecht" });
    expect(await searchListedClinics("z")).toEqual([]);
  });

  it("serves a per-clinic manifest scoped to that clinic's app", async () => {
    const res = await manifestRoute.GET(new Request("http://x"), { params: Promise.resolve({ merchantSlug: slug("pwa-hidden") }) });
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: `Zephyr Hidden ${stamp}`, start_url: `/app/${slug("pwa-hidden")}`, display: "standalone" });
    expect(m.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
  });

  it("gives suspended or unknown clinics no manifest and no icon", async () => {
    for (const s of [slug("pwa-suspended"), "no-such-clinic-xyz"]) {
      expect((await manifestRoute.GET(new Request("http://x"), { params: Promise.resolve({ merchantSlug: s }) })).status).toBe(404);
      expect((await iconRoute.GET(new Request("http://x"), { params: Promise.resolve({ merchantSlug: s, file: "192.png" }) })).status).toBe(404);
    }
  });

  it("renders a home-screen icon", async () => {
    const res = await iconRoute.GET(new Request("http://x"), { params: Promise.resolve({ merchantSlug: slug("pwa-listed"), file: "180.png" }) });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });
});
