/**
 * The demo seed hashes passwords exactly as production does.
 *
 * docs/security/review-2026-11-pass2.md, note 2 under A-3: the seed used
 * bcrypt cost 10 while every production path uses 12, so a wrong password
 * against a seeded account answered about four times faster than against an
 * unknown address — and timing told the two apart. The seed now calls the
 * production hasher, so the two cannot drift apart again.
 *
 * The seed itself is not run by the suite (it builds a full demo dataset);
 * this reads its source, and checks the hasher it now uses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hashPassword } from "@/lib/password";

describe("the demo seed's passwords", () => {
  const source = readFileSync("prisma/seed.ts", "utf8");

  it("are hashed by the production hasher, with no cost of its own", () => {
    expect(source).toMatch(/import \{[^}]*\bhashPassword\b[^}]*\} from "\.\.\/lib\/password"/);
    expect(source).not.toMatch(/bcrypt\.hash(Sync)?\(/);
    expect(source).not.toMatch(/from "bcryptjs"/);
  });

  it("which uses cost 12", async () => {
    expect(await hashPassword("Password123!")).toMatch(/^\$2[aby]\$12\$/);
  });
});
