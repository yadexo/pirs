/**
 * One function per transactional email, each returning {subject, html, text}
 * from plain data — no database access here, so these can be driven by the
 * staff preview page with made-up data exactly as easily as by a real send.
 *
 * None of these ever gets an unsubscribe link: every one is service mail
 * about something that already happened to the client's own order, account
 * or money, not an offer — see lib/emails/layout.ts.
 */
import { emailButton, emailLayout, emailParagraph, escapeHtml, type EmailBranding } from "./layout";

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

function greeting(firstName: string): string {
  return firstName ? `Hi ${firstName},` : "Hi,";
}

// --------------------------------------------------------------- receipts

export function orderReceiptEmail(params: {
  branding: EmailBranding;
  firstName: string;
  orderNumber: string;
  lines: { name: string; quantity: number; totalCents: number }[];
  totalCents: number;
  vatCents: number;
  currency: string;
  myItemsUrl: string;
}): EmailTemplate {
  const { branding, firstName, orderNumber, lines, totalCents, vatCents, currency, myItemsUrl } = params;
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;color:#444;">${escapeHtml(l.name)}${l.quantity > 1 ? ` × ${l.quantity}` : ""}</td><td style="padding:6px 0;text-align:right;color:#444;">${money(l.totalCents, currency)}</td></tr>`,
    )
    .join("");
  const html =
    emailParagraph(`${greeting(firstName)} thanks for your order from ${branding.name} — here's your receipt.`) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid #ececec;border-bottom:1px solid #ececec;">${rows}</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr><td style="font-weight:700;">Total incl. VAT</td><td style="text-align:right;font-weight:700;">${money(totalCents, currency)}</td></tr></table>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#8a8d94;">of which VAT: ${money(vatCents, currency)}</p>` +
    emailButton("View my items", myItemsUrl, branding.color);
  const text = [
    `${greeting(firstName)} thanks for your order from ${branding.name} — here's your receipt.`,
    "",
    ...lines.map((l) => `${l.name}${l.quantity > 1 ? ` x${l.quantity}` : ""} — ${money(l.totalCents, currency)}`),
    "",
    `Total incl. VAT: ${money(totalCents, currency)}`,
    `of which VAT: ${money(vatCents, currency)}`,
    "",
    `View my items: ${myItemsUrl}`,
  ].join("\n");
  return { subject: `Your receipt from ${branding.name} — ${orderNumber}`, html: emailLayout({ branding, preheader: `Receipt for ${orderNumber}`, bodyHtml: html }), text };
}

export function refundConfirmationEmail(params: {
  branding: EmailBranding;
  firstName: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  fully: boolean;
}): EmailTemplate {
  const { branding, firstName, orderNumber, amountCents, currency, fully } = params;
  const line = `${fully ? "You've been refunded" : "You've been partly refunded"} ${money(amountCents, currency)} for order ${orderNumber}.`;
  const html = emailParagraph(`${greeting(firstName)} ${line}`) + emailParagraph("It can take a few days to reach your bank or card, depending on your bank.");
  const text = [`${greeting(firstName)} ${line}`, "", "It can take a few days to reach your bank or card, depending on your bank."].join("\n");
  return { subject: `Refund confirmed — ${orderNumber}`, html: emailLayout({ branding, preheader: line, bodyHtml: html }), text };
}

// ------------------------------------------------------------------ auth

export function passwordResetEmail(params: { branding: EmailBranding; resetUrl: string }): EmailTemplate {
  const { branding, resetUrl } = params;
  const html =
    emailParagraph(`Someone asked to reset the password for ${branding.name}.`) +
    emailParagraph("Choose a new password here. The link works once, for one hour.") +
    emailButton("Reset password", resetUrl, branding.color) +
    `<p style="margin:0;font-size:13px;color:#8a8d94;">If this wasn't you, ignore this email and your password stays the same.</p>`;
  const text = [
    `Someone asked to reset the password for ${branding.name}.`,
    "",
    "Choose a new password here. The link works once, for one hour:",
    resetUrl,
    "",
    "If this wasn't you, ignore this email and your password stays the same.",
  ].join("\n");
  return { subject: `Reset your password for ${branding.name}`, html: emailLayout({ branding, preheader: "Reset your password", bodyHtml: html }), text };
}

export function welcomeClientEmail(params: { branding: EmailBranding; firstName: string; openAppUrl: string }): EmailTemplate {
  const { branding, firstName, openAppUrl } = params;
  const html =
    emailParagraph(`${greeting(firstName)} your account at ${branding.name} is ready.`) +
    emailParagraph("Book treatments, earn and spend points, and keep your receipts — all from the app.") +
    emailButton("Open the app", openAppUrl, branding.color);
  const text = [`${greeting(firstName)} your account at ${branding.name} is ready.`, "", `Open the app: ${openAppUrl}`].join("\n");
  return { subject: `Welcome to ${branding.name}`, html: emailLayout({ branding, preheader: `Welcome to ${branding.name}`, bodyHtml: html }), text };
}

export function welcomeClinicOwnerEmail(params: { branding: EmailBranding; ownerName: string; clinicName: string; loginUrl: string }): EmailTemplate {
  const { branding, ownerName, clinicName, loginUrl } = params;
  const html =
    emailParagraph(`${greeting(ownerName)} ${clinicName}'s portal is ready.`) +
    emailParagraph("Set your password with the link below, then you're straight into your dashboard.") +
    emailButton("Set your password and sign in", loginUrl, branding.color);
  const text = [`${greeting(ownerName)} ${clinicName}'s portal is ready.`, "", `Set your password and sign in: ${loginUrl}`].join("\n");
  return { subject: `Welcome to ${branding.name} — ${clinicName} is ready`, html: emailLayout({ branding, preheader: `${clinicName} is ready`, bodyHtml: html }), text };
}

// ----------------------------------------------------------- memberships

export function membershipPaymentReceivedEmail(params: {
  branding: EmailBranding;
  firstName: string;
  planName: string;
  amountCents: number;
  currency: string;
}): EmailTemplate {
  const { branding, firstName, planName, amountCents, currency } = params;
  const line = `Payment received for your ${planName} — ${money(amountCents, currency)}. Thank you!`;
  const html = emailParagraph(`${greeting(firstName)} ${line}`);
  return {
    subject: `Payment received — ${planName}`,
    html: emailLayout({ branding, preheader: line, bodyHtml: html }),
    text: `${greeting(firstName)} ${line}`,
  };
}

export function membershipPaymentFailedEmail(params: {
  branding: EmailBranding;
  firstName: string;
  planName: string;
  updatePaymentUrl: string;
  benefitsEndAt: string | null;
}): EmailTemplate {
  const { branding, firstName, planName, updatePaymentUrl, benefitsEndAt } = params;
  const deadline = benefitsEndAt ? ` Your benefits continue until ${benefitsEndAt}.` : "";
  const html =
    emailParagraph(`${greeting(firstName)} we couldn't take the payment for your ${planName}.`) +
    emailParagraph(`Update your card to keep it.${deadline}`) +
    emailButton("Update payment method", updatePaymentUrl, branding.color);
  const text = [`${greeting(firstName)} we couldn't take the payment for your ${planName}.`, `Update your card to keep it.${deadline}`, "", `Update payment method: ${updatePaymentUrl}`].join("\n");
  return { subject: `Action needed — your ${planName} payment failed`, html: emailLayout({ branding, preheader: "Your payment failed", bodyHtml: html }), text };
}

export function membershipPriceChangeEmail(params: {
  branding: EmailBranding;
  firstName: string;
  planName: string;
  newPriceCents: number;
  currency: string;
  effectiveDate: string;
  manageUrl: string;
}): EmailTemplate {
  const { branding, firstName, planName, newPriceCents, currency, effectiveDate, manageUrl } = params;
  const line = `${planName} becomes ${money(newPriceCents, currency)} from ${effectiveDate}. You can cancel any time before then.`;
  const html =
    emailParagraph(`${greeting(firstName)} ${line}`) +
    emailParagraph(`Nothing changes before ${effectiveDate}, and the payments until then stay at the price you signed up on.`) +
    emailButton("Manage membership", manageUrl, branding.color);
  const text = [
    `${greeting(firstName)} ${line}`,
    "",
    `Nothing changes before ${effectiveDate}, and the payments until then stay at the price you signed up on.`,
    "",
    `Manage membership: ${manageUrl}`,
  ].join("\n");
  return { subject: `Your ${planName} price is changing`, html: emailLayout({ branding, preheader: line, bodyHtml: html }), text };
}

// --------------------------------------------------------- session packages

export function sessionsExpiringEmail(params: {
  branding: EmailBranding;
  firstName: string;
  packageName: string;
  sessions: number;
  endsOn: string;
  myItemsUrl: string;
}): EmailTemplate {
  const { branding, firstName, packageName, sessions, endsOn, myItemsUrl } = params;
  const line = `${sessions} ${packageName} session${sessions === 1 ? "" : "s"} left — they run out on ${endsOn}.`;
  const html = emailParagraph(`${greeting(firstName)} ${line}`) + emailButton("View my items", myItemsUrl, branding.color);
  return {
    subject: `${packageName}: sessions expiring soon`,
    html: emailLayout({ branding, preheader: line, bodyHtml: html }),
    text: [`${greeting(firstName)} ${line}`, "", `View my items: ${myItemsUrl}`].join("\n"),
  };
}
