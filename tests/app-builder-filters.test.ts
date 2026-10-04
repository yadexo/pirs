import { describe, it, expect } from "vitest";
import { defaultFilterFor } from "@/lib/app-builder-filters";

/**
 * Offers opens on Visible. Every offer a clinic has ever used is kept rather
 * than deleted, so "everything" is a list that only grows — and the offers
 * somebody is actually working on end up buried in the ones they tried to
 * delete. Hidden is one click away.
 */
describe("which filter a tab starts on", () => {
  it("opens Offers on Visible", () => {
    expect(defaultFilterFor("offers")).toBe("visible");
  });

  it("leaves every other tab showing everything", () => {
    for (const tab of ["products", "membership", "rewards", "custom-plans"]) {
      expect(defaultFilterFor(tab), tab).toBe("all");
    }
  });

  it("falls back to everything for a tab it has never heard of", () => {
    expect(defaultFilterFor("something-new")).toBe("all");
  });
});
