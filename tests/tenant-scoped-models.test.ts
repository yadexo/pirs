/**
 * The list of tenant-scoped models, checked against the schema.
 *
 * getTenantDb() only adds a clinic filter to models named in
 * TENANT_SCOPED_MODELS. A model left off the list raises no error anywhere:
 * it is just read across every clinic by code that thinks it is scoped. That
 * is what happened to RedeemableItem (docs/security/review-2026-11.md, T-1),
 * and it passed 1,498 tests, because none of them asked this question.
 *
 * So: every model in schema.prisma that has a `tenantId` column must be on
 * the list, or be named below with the reason it is not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TENANT_SCOPED_MODELS } from "@/lib/tenant-db";

/**
 * Models with a tenantId that are deliberately not scoped. Empty, and meant
 * to stay that way — an entry here needs a reason a reviewer would accept.
 */
const DELIBERATELY_UNSCOPED: Record<string, string> = {};

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

/** Every model, with whether it carries its own tenantId column. */
function models(): { name: string; hasTenantId: boolean }[] {
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
    name: name!,
    // A scalar field called tenantId — not a relation that merely mentions it.
    hasTenantId: /^\s+tenantId\s+String\b/m.test(body!),
  }));
}

describe("the tenant-scoped model list", () => {
  it("reads the schema at all (a parser that finds nothing would pass everything)", () => {
    const all = models();
    expect(all.length).toBeGreaterThan(50);
    expect(all.find((m) => m.name === "CustomerProfile")?.hasTenantId).toBe(true);
    expect(all.find((m) => m.name === "OrderItem")?.hasTenantId).toBe(false);
  });

  it("includes every model that has a tenantId column", () => {
    const missing = models()
      .filter((m) => m.hasTenantId && !TENANT_SCOPED_MODELS.has(m.name) && !(m.name in DELIBERATELY_UNSCOPED))
      .map((m) => m.name);
    // If this fails for a model you just added: add it to TENANT_SCOPED_MODELS
    // in lib/tenant-db.ts. Until you do, every clinic can read every other
    // clinic's rows of it.
    expect(missing).toEqual([]);
  });

  it("names only models that exist and can actually be scoped", () => {
    const byName = new Map(models().map((m) => [m.name, m]));
    for (const name of TENANT_SCOPED_MODELS) {
      expect(byName.has(name), `${name} is on the list but not in the schema`).toBe(true);
      // Scoping adds `where: { tenantId }`; on a model without the column
      // that is a query error on every read.
      expect(byName.get(name)!.hasTenantId, `${name} is on the list but has no tenantId column`).toBe(true);
    }
  });

  it("has no stale exemptions", () => {
    const byName = new Map(models().map((m) => [m.name, m]));
    for (const name of Object.keys(DELIBERATELY_UNSCOPED)) {
      expect(byName.get(name)?.hasTenantId, `${name} is exempted but has no tenantId column`).toBe(true);
      expect(TENANT_SCOPED_MODELS.has(name), `${name} is both scoped and exempted`).toBe(false);
    }
  });
});
