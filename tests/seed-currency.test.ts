import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The seed isn't run as part of the suite (it builds a full demo dataset,
 * meant for `npm run seed` against a dev database) — this just pins the
 * literal so the demo clinic stays on the platform default.
 */
describe("the seeded demo clinic", () => {
  it("defaults to EUR, not USD", () => {
    const source = readFileSync("prisma/seed.ts", "utf8");
    expect(source).toMatch(/currency:\s*"EUR"/);
    expect(source).not.toMatch(/currency:\s*"USD"/);
  });
});
