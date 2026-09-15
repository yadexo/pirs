import { describe, it, expect } from "vitest";
import { rawDb } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";

/**
 * Permission rows are reference data inserted by migrations, not by the demo
 * seed. A key added to lib/permissions.ts without a migration would exist in
 * code but be impossible to grant in any real database.
 */
describe("permission reference data", () => {
  it("has a row for every permission the code knows about", async () => {
    const rows = await rawDb.permission.findMany({ select: { key: true } });
    const inDb = new Set(rows.map((r) => r.key));
    expect(PERMISSIONS.map((p) => p.key).filter((k) => !inDb.has(k))).toEqual([]);
  });
});
