import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A treatment is bought in the app and booked on the clinic's own page. The
 * rule the whole feature turns on is that a link the clinic has not set is
 * never guessed at: no button, and the client is told to come to the desk.
 */

const FORM = readFileSync("app/m/[merchantId]/app-builder/product-form.tsx", "utf8");
const ACTION = readFileSync("lib/actions/app-builder.ts", "utf8");
const DASH = readFileSync("app/m/[merchantId]/page.tsx", "utf8");
const ITEMS = readFileSync("app/app/[merchantSlug]/profile/my-items.tsx", "utf8");
const RESULT = readFileSync("app/app/[merchantSlug]/payment-result.tsx", "utf8");
const HOME = readFileSync("app/app/[merchantSlug]/home-view.tsx", "utf8");

describe("the portal asks for the link", () => {
  it("shows the field on a treatment and not on a product", () => {
    expect(FORM).toMatch(/kind === "service" \? \(\s*<TextField\s*label="Booking link"/);
  });

  it("says where the link goes, so it is not mistaken for ours", () => {
    expect(FORM).toMatch(/Opens your own booking page/);
  });

  it("refuses to save a treatment without one, and says what to do", () => {
    expect(ACTION).toMatch(/if \(!shared\.schedulingUrl\)/);
    expect(ACTION).toMatch(/Add the booking link to save/);
    // Under the field, not just at the top of the form.
    expect(ACTION).toMatch(/\{ schedulingUrl: "Add the link clients use to book this treatment" \}/);
  });
});

describe("the portal says which treatments are missing one", () => {
  it("counts them on the dashboard, with somewhere to go", () => {
    expect(DASH).toMatch(/schedulingUrl: null.*schedulingUrl: ""/s);
    expect(DASH).toMatch(/no booking link/);
    expect(DASH).toMatch(/Add booking links/);
  });

  it("badges the row in the products list", () => {
    expect(readFileSync("app/m/[merchantId]/app-builder/page.tsx", "utf8")).toMatch(
      /warning: s\.schedulingUrl \? undefined : "Booking link missing"/,
    );
  });
});

describe("the client app only offers what the clinic set up", () => {
  it("shows Book appointment in My items when there is a link", () => {
    expect(ITEMS).toMatch(/\{item\.bookingUrl && \(/);
    expect(ITEMS).toMatch(/Book appointment/);
  });

  it("says to come to the desk when there is none", () => {
    expect(ITEMS).toMatch(/item\.bookingUrl \? "Ready to book" : "Show your code at the desk"/);
  });

  it("leads the result screen with the items when nothing can be booked", () => {
    expect(RESULT).toMatch(/toBook\.length === 0\s*\?\s*"Your items are ready"/);
    expect(RESULT).toMatch(/View my items/);
  });

  it("gives one Book button per treatment when an order has several", () => {
    expect(RESULT).toMatch(/toBook\.map\(\(t\) => \(/);
    expect(RESULT).toMatch(/toBook\.length === 1\s*\?\s*"Book your treatment"\s*:\s*"Book your treatments"/);
  });

  it("mentions the rest of the order rather than hiding it behind the booking", () => {
    expect(RESULT).toMatch(/receipt\.itemsToCollect > toBook\.length/);
  });

  it("puts Book beside Buy again, and only when there is a link", () => {
    expect(HOME).toMatch(/\{b\.bookingUrl && \(/);
    expect(HOME).toMatch(/Buy again/);
  });

  it("opens the clinic's page in a new tab, safely", () => {
    for (const [name, source] of [["my items", ITEMS], ["result", RESULT], ["home", HOME]] as const) {
      const links = source.match(/href=\{[^}]*ookingUrl[^}]*\}|href=\{t\.url\}/g) ?? [];
      expect(links.length, `${name} has no booking link`).toBeGreaterThan(0);
      expect(source, `${name} should open it in a new tab`).toMatch(/target="_blank" rel="noreferrer"/);
    }
  });
});
