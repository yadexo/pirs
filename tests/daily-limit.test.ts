import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ rawDb: {} }));
vi.mock("@/lib/web-push", () => ({ sendToClient: async () => ({ sent: 1, removed: 0, failed: 0 }), notifyClientQuietly: async () => {} }));

const { overDailyLimit } = await import("@/lib/marketing");

/**
 * How many messages a clinic may send one client in a day. Zero is the
 * clinic saying "no limit", not "never".
 */
describe("the daily limit", () => {
  it("lets the first through and stops the second, at the default of one", () => {
    expect(overDailyLimit(0, 1)).toBe(false);
    expect(overDailyLimit(1, 1)).toBe(true);
    expect(overDailyLimit(2, 1)).toBe(true);
  });

  it("counts up to whatever the clinic chose", () => {
    for (const limit of [2, 3, 5]) {
      for (let sent = 0; sent < limit; sent++) expect(overDailyLimit(sent, limit)).toBe(false);
      expect(overDailyLimit(limit, limit)).toBe(true);
      expect(overDailyLimit(limit + 1, limit)).toBe(true);
    }
  });

  it("never stops anyone when the clinic set no limit", () => {
    for (const sent of [0, 1, 5, 40]) expect(overDailyLimit(sent, 0)).toBe(false);
  });
});
