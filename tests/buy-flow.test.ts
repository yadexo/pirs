import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cartTotals } from "@/lib/cart-totals";
import { formatDay, formatTime, formatShortDay, formatWeekday, formatNumber, APP_LOCALE } from "@/lib/client-format";

/**
 * The buy flow's promises to a client: that the button says what it costs,
 * that the total is the total, and that nothing is asked for once the money
 * is already covered.
 */

const CART = readFileSync("app/app/[merchantSlug]/cart-sheet.tsx", "utf8");
const PAY = readFileSync("app/app/[merchantSlug]/card-payment.tsx", "utf8");
const RESULT = readFileSync("app/app/[merchantSlug]/payment-result.tsx", "utf8");
const SHOP = readFileSync("app/app/[merchantSlug]/shop/shop-view.tsx", "utf8");

describe("the button that takes the money", () => {
  it("never says 'Place order'", () => {
    // It would hide the one number the client is agreeing to.
    for (const [name, source] of [["cart", CART], ["payment", PAY]] as const) {
      expect(source, `${name} says "Place order"`).not.toMatch(/Place order/);
    }
  });

  it("carries the amount inside it", () => {
    // Button's `amount` prop right-aligns the money in the button itself.
    expect(CART).toMatch(/amount=\{settledByCreditAlone \? undefined : total\}/);
  });

  it("says 'Pay €X and join' for a membership, which is a different promise", () => {
    expect(SHOP).toMatch(/payLabel=\{`Pay \$\{money\(firstPayment\.amountCents, currency\)\} and join`\}/);
  });
});

describe("what a client is told they owe", () => {
  it("labels the total as including VAT", () => {
    expect(CART).toMatch(/Total incl\. VAT/);
    expect(RESULT).toMatch(/Total paid, incl\. VAT/);
  });

  it("says there is nothing else to come, before the button rather than after it", () => {
    const noCosts = CART.indexOf("No extra costs");
    const button = CART.indexOf("const footer =");
    expect(noCosts, "the reassurance is missing").toBeGreaterThan(-1);
    // The footer is built above the body in the source; what matters is that
    // the client reads it on the way to the button, which is the last block.
    expect(button).toBeGreaterThan(-1);
  });
});

describe("when Credit covers the whole order", () => {
  const covered = cartTotals({ subtotalCents: 5000, rewardDiscountCents: 0, autoDiscountCents: 0, creditAvailableCents: 8000, useCredit: true });
  const partly = cartTotals({ subtotalCents: 5000, rewardDiscountCents: 0, autoDiscountCents: 0, creditAvailableCents: 2000, useCredit: true });
  const free = cartTotals({ subtotalCents: 5000, rewardDiscountCents: 5000, autoDiscountCents: 0, creditAvailableCents: 8000, useCredit: true });

  it("leaves nothing to charge", () => {
    expect(covered.totalCents).toBe(0);
    expect(covered.settledByCreditAlone).toBe(true);
  });

  it("still has something to charge when the credit only goes part way", () => {
    expect(partly.totalCents).toBe(3000);
    expect(partly.settledByCreditAlone).toBe(false);
  });

  it("does not claim credit paid for a basket a reward made free", () => {
    expect(free.totalCents).toBe(0);
    expect(free.settledByCreditAlone).toBe(false);
  });

  it("hides the payment methods and says 'Paid with Credit'", () => {
    expect(CART).toMatch(/settledByCreditAlone && \(/);
    expect(CART).toMatch(/Paid with Credit/);
    // The card step is only reached when checkout came back unpaid.
    expect(CART).toMatch(/if \(!res\.paid\) \{/);
  });
});

describe("the brand marks", () => {
  it("come from Stripe's own elements, never from a logo drawn here", () => {
    // Apple's button has rules about its size, wording and corner radius, and
    // iDEAL, Wero and Klarna are trademarks. The Express Checkout Element
    // renders Apple Pay's own button; the Payment Element renders each
    // method's own mark. Nothing in this repo draws one.
    expect(PAY).toMatch(/ExpressCheckoutElement/);
    expect(PAY).toMatch(/<PaymentElement/);
    expect(PAY).not.toMatch(/apple-?pay\.svg|ideal\.svg|klarna\.svg|visa|mastercard/i);
  });

  it("shows no wallet row on a device that has no wallet", () => {
    expect(PAY).toMatch(/hidden=\{!hasWallet\}/);
  });
});

describe("the result screen", () => {
  it("tells the client their items are ready and where to find them", () => {
    expect(RESULT).toMatch(/Your items are ready/);
    expect(RESULT).toMatch(/View my items/);
    expect(RESULT).toMatch(/profile\?tab=items/);
  });

  it("asks the server what happened rather than reading it off the address", () => {
    expect(RESULT).toMatch(/clientOrderStatusAction/);
    expect(RESULT).not.toMatch(/searchParams.*paid/);
  });
});

describe("Credit is called Credit", () => {
  it("in the cart, the checkout and the receipt", () => {
    for (const [name, source] of [["cart", CART], ["result", RESULT]] as const) {
      expect(source, `${name} still says "Patient App Cash"`).not.toMatch(/Patient App Cash/);
      expect(source, `${name} still says "account credit"`).not.toMatch(/account credit/i);
    }
    expect(CART).toMatch(/Use Credit/);
  });
});

/* ------------------------------------------------------- hydration safety */

describe("dates and numbers the server and the phone both render", () => {
  const iso = "2026-08-22T13:00:00.000Z";

  it("are pinned to one locale, so Node and the browser agree", () => {
    expect(APP_LOCALE).toBe("en-GB");
    // The bug this prevents: toLocaleTimeString([]) gave "15:00" on the
    // server and "03:00 PM" in Chrome, and React threw the tree away (#418).
    expect(formatTime(iso, "Europe/Amsterdam")).toBe("15:00");
    expect(formatDay(iso, "Europe/Amsterdam")).toBe("22 Aug 2026");
    expect(formatShortDay(iso, "Europe/Amsterdam")).toBe("22 Aug");
    expect(formatWeekday(iso, "Europe/Amsterdam")).toBe("Sat 22 Aug");
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("are in the clinic's time zone, not the phone's", () => {
    // Same instant, two clinics: each client is told when to be there.
    expect(formatTime(iso, "Europe/Amsterdam")).toBe("15:00");
    expect(formatTime(iso, "America/New_York")).toBe("09:00");
  });

  it("fall back to a fixed zone rather than the machine's", () => {
    expect(formatTime(iso, null)).toBe(formatTime(iso, "Europe/Amsterdam"));
    expect(formatTime(iso, "")).toBe(formatTime(iso, "Europe/Amsterdam"));
  });

  it("are the only way the client app formats a date or a number", () => {
    // A bare toLocaleString resolves differently on the two machines that
    // render this page. Every one of them is a hydration bug waiting.
    const offenders: string[] = [];
    const files = [
      "app/app/[merchantSlug]/home-view.tsx",
      "app/app/[merchantSlug]/shop/shop-view.tsx",
      "app/app/[merchantSlug]/shop/booking-sheet.tsx",
      "app/app/[merchantSlug]/profile/profile-view.tsx",
      "app/app/[merchantSlug]/profile/my-items.tsx",
      "app/app/[merchantSlug]/cart-sheet.tsx",
      "app/app/[merchantSlug]/payment-result.tsx",
      "components/client-app/ui.tsx",
      "components/client-app/v2.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (/toLocale(Date|Time|)String\s*\(/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        // Intl with no locale, or with the runtime's own.
        if (/new Intl\.\w+\(\s*(\)|\[\]|undefined)/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
