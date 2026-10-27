import { describe, it, expect } from "vitest";
import {
  membershipPaymentFailedEmail,
  membershipPaymentReceivedEmail,
  membershipPriceChangeEmail,
  orderReceiptEmail,
  passwordResetEmail,
  refundConfirmationEmail,
  sessionsExpiringEmail,
  welcomeClientEmail,
  welcomeClinicOwnerEmail,
} from "@/lib/emails/templates";
import { senderFor } from "@/lib/emails/sender";
import type { EmailBranding } from "@/lib/emails/layout";

const branding: EmailBranding = { name: "Riverside Wellness Clinic", logoUrl: "https://example.com/logo.png", color: "#0f766e" };

const LOCALES = ["en", "nl"] as const;

function allTemplates(locale: (typeof LOCALES)[number]) {
  return [
    () => orderReceiptEmail({ branding, firstName: "Emma", orderNumber: "ORD-1", lines: [{ name: "Massage", quantity: 1, totalCents: 9500 }], totalCents: 9500, vatCents: 1650, currency: "EUR", myItemsUrl: "https://example.com/items", locale }),
    () => refundConfirmationEmail({ branding, firstName: "Emma", orderNumber: "ORD-1", amountCents: 9500, currency: "EUR", fully: true, locale }),
    () => passwordResetEmail({ branding, resetUrl: "https://example.com/reset", locale }),
    () => welcomeClientEmail({ branding, firstName: "Emma", openAppUrl: "https://example.com/app", locale }),
    () => welcomeClinicOwnerEmail({ branding, ownerName: "Jordan", clinicName: "Riverside Wellness Clinic", loginUrl: "https://example.com/set-password", locale }),
    () => membershipPaymentReceivedEmail({ branding, firstName: "Emma", planName: "Essentials", amountCents: 4900, currency: "EUR", locale }),
    () => membershipPaymentFailedEmail({ branding, firstName: "Emma", planName: "Essentials", updatePaymentUrl: "https://example.com/pay", benefitsEndAt: "1 January 2027", locale }),
    () => membershipPriceChangeEmail({ branding, firstName: "Emma", planName: "Essentials", newPriceCents: 5900, currency: "EUR", effectiveDate: "1 January 2027", manageUrl: "https://example.com/manage", locale }),
    () => sessionsExpiringEmail({ branding, firstName: "Emma", packageName: "Acupuncture Pack", sessions: 2, endsOn: "1 January 2027", myItemsUrl: "https://example.com/items", locale }),
  ];
}

describe("transactional email templates", () => {
  for (const locale of LOCALES) {
    it(`every one has a non-empty subject, html and text, and brands with the clinic's logo and colour (${locale})`, () => {
      for (const build of allTemplates(locale)) {
        const t = build();
        expect(t.subject.length).toBeGreaterThan(0);
        expect(t.html).toContain("<!doctype html>");
        expect(t.html).toContain(branding.logoUrl!);
        expect(t.html).toContain(branding.color!);
        expect(t.text.length).toBeGreaterThan(0);
        // The HTML shell's own chrome shouldn't leak into the plain-text copy.
        expect(t.text).not.toContain("<");
      }
    });

    it(`never carries an unsubscribe link — every one of these is service mail, not an offer (${locale})`, () => {
      for (const build of allTemplates(locale)) {
        expect(build().html.toLowerCase()).not.toContain("unsubscribe");
      }
    });
  }

  it("switches the whole template, not just a label, between locales", () => {
    const en = orderReceiptEmail({ branding, firstName: "Emma", orderNumber: "ORD-1", lines: [{ name: "Massage", quantity: 1, totalCents: 9500 }], totalCents: 9500, vatCents: 1650, currency: "EUR", myItemsUrl: "https://example.com/items", locale: "en" });
    const nl = orderReceiptEmail({ branding, firstName: "Emma", orderNumber: "ORD-1", lines: [{ name: "Massage", quantity: 1, totalCents: 9500 }], totalCents: 9500, vatCents: 1650, currency: "EUR", myItemsUrl: "https://example.com/items", locale: "nl" });
    expect(en.subject).toContain("Your receipt");
    expect(nl.subject).toContain("Je bon");
    expect(en.text).toContain("Total incl. VAT");
    expect(nl.text).toContain("Totaal incl. btw");
  });

  it("escapes a clinic name or client name that contains HTML", () => {
    const hostile: EmailBranding = { name: "<script>alert(1)</script>", logoUrl: null, color: "#0f766e" };
    const t = welcomeClientEmail({ branding: hostile, firstName: "<b>Emma</b>", openAppUrl: "https://example.com", locale: "en" });
    expect(t.html).not.toContain("<script>");
    expect(t.html).not.toContain("<b>Emma</b>");
  });

  it("the order receipt shows the total incl. VAT and the VAT it contains", () => {
    const t = orderReceiptEmail({
      branding,
      firstName: "Emma",
      orderNumber: "ORD-9",
      lines: [{ name: "Massage", quantity: 1, totalCents: 10000 }],
      totalCents: 10000,
      vatCents: 1736,
      currency: "EUR",
      myItemsUrl: "https://example.com/items",
      locale: "en",
    });
    expect(t.html).toMatch(/Total incl\. VAT/);
    expect(t.html).toContain("of which VAT");
    expect(t.text).toContain("Total incl. VAT");
    expect(t.text).toContain("of which VAT");
  });
});

describe("senderFor", () => {
  it("builds 'Clinic Name <address>' from a bare EMAIL_FROM address", () => {
    const prev = process.env.EMAIL_FROM;
    process.env.EMAIL_FROM = "notifications@example.com";
    expect(senderFor("Riverside Wellness Clinic")).toBe("Riverside Wellness Clinic <notifications@example.com>");
    process.env.EMAIL_FROM = prev;
  });

  it("keeps the address but replaces the display name when EMAIL_FROM already has one", () => {
    const prev = process.env.EMAIL_FROM;
    process.env.EMAIL_FROM = "Old Name <notifications@example.com>";
    expect(senderFor("Riverside Wellness Clinic")).toBe("Riverside Wellness Clinic <notifications@example.com>");
    process.env.EMAIL_FROM = prev;
  });

  it("strips characters that would break the header, and never sends an empty name", () => {
    const prev = process.env.EMAIL_FROM;
    process.env.EMAIL_FROM = "notifications@example.com";
    expect(senderFor('Weird "Clinic" <Name>')).toBe("Weird Clinic Name <notifications@example.com>");
    expect(senderFor("")).toBe("Notifications <notifications@example.com>");
    process.env.EMAIL_FROM = prev;
  });

  it("returns undefined with no EMAIL_FROM configured, so the provider falls back to its own default", () => {
    const prev = process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM;
    expect(senderFor("Riverside Wellness Clinic")).toBeUndefined();
    process.env.EMAIL_FROM = prev;
  });
});
