/**
 * Every transactional template, rendered once with made-up data, for the
 * staff-only preview page. Nothing here touches the database beyond the
 * branding the caller already has — same templates, same inputs shape a real
 * send would use.
 */
import type { EmailBranding } from "./layout";
import type { EmailTemplate } from "./templates";
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
} from "./templates";

export interface PreviewEntry {
  label: string;
  template: EmailTemplate;
}

export function buildPreviewTemplates(branding: EmailBranding, slug: string): Record<string, PreviewEntry> {
  const base = `https://example.com/app/${slug}`;
  const firstName = "Jordan";

  return {
    "order-receipt": {
      label: "Order confirmation / receipt",
      template: orderReceiptEmail({
        branding,
        firstName,
        orderNumber: "ORD-PREV1234",
        lines: [
          { name: "Deep Tissue Massage", quantity: 1, totalCents: 9500 },
          { name: "Wellness Starter Bundle", quantity: 1, totalCents: 4500 },
        ],
        totalCents: 14000,
        vatCents: 2431,
        currency: "EUR",
        myItemsUrl: `${base}/profile?tab=items`,
      }),
    },
    "refund-confirmation": {
      label: "Refund confirmation",
      template: refundConfirmationEmail({ branding, firstName, orderNumber: "ORD-PREV1234", amountCents: 4500, currency: "EUR", fully: false }),
    },
    "password-reset": {
      label: "Password reset",
      template: passwordResetEmail({ branding, resetUrl: `https://example.com/set-password?token=preview` }),
    },
    "welcome-client": {
      label: "Welcome — new client",
      template: welcomeClientEmail({ branding, firstName, openAppUrl: base }),
    },
    "welcome-owner": {
      label: "Welcome — new clinic owner",
      template: welcomeClinicOwnerEmail({ branding, ownerName: firstName, clinicName: branding.name, loginUrl: `https://example.com/set-password?token=preview` }),
    },
    "membership-received": {
      label: "Membership: payment received",
      template: membershipPaymentReceivedEmail({ branding, firstName, planName: "Wellness Essentials", amountCents: 4900, currency: "EUR" }),
    },
    "membership-failed": {
      label: "Membership: payment failed",
      template: membershipPaymentFailedEmail({
        branding,
        firstName,
        planName: "Wellness Essentials",
        updatePaymentUrl: `${base}/profile?tab=membership`,
        benefitsEndAt: "14 November 2026",
      }),
    },
    "membership-price-change": {
      label: "Membership: price change notice",
      template: membershipPriceChangeEmail({
        branding,
        firstName,
        planName: "Wellness Essentials",
        newPriceCents: 5900,
        currency: "EUR",
        effectiveDate: "1 December 2026",
        manageUrl: `${base}/profile?tab=membership`,
      }),
    },
    "sessions-expiring": {
      label: "Session package expiry reminder",
      template: sessionsExpiringEmail({ branding, firstName, packageName: "10-Session Acupuncture Pack", sessions: 2, endsOn: "20 November 2026", myItemsUrl: `${base}/profile` }),
    },
  };
}
