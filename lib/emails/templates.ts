/**
 * One function per transactional email, each returning {subject, html, text}
 * from plain data — no database access here, so these can be driven by the
 * staff preview page with made-up data exactly as easily as by a real send.
 *
 * Every function takes the recipient's own `locale` and picks its copy from
 * that — these run outside any React/next-intl request context much of the
 * time (Stripe webhooks, cron), so there's no useTranslations()/
 * getTranslations() available here; see each caller for how `locale` is
 * worked out (lib/client-notifications.ts, lib/actions/auth.ts,
 * lib/actions/merchants.ts, lib/actions/password.ts).
 *
 * None of these ever gets an unsubscribe link: every one is service mail
 * about something that already happened to the client's own order, account
 * or money, not an offer — see lib/emails/layout.ts.
 */
import { emailButton, emailLayout, emailParagraph, escapeHtml, type EmailBranding } from "./layout";
import type { AppLocale } from "@/lib/locale-cookie";

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

function greeting(locale: AppLocale, firstName: string): string {
  if (locale === "nl") return firstName ? `Hoi ${firstName},` : "Hoi,";
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
  locale: AppLocale;
}): EmailTemplate {
  const { branding, firstName, orderNumber, lines, totalCents, vatCents, currency, myItemsUrl, locale } = params;
  const nl = locale === "nl";
  const intro = `${greeting(locale, firstName)} ${nl ? `bedankt voor je bestelling bij ${branding.name} — hier is je bon.` : `thanks for your order from ${branding.name} — here's your receipt.`}`;
  const totalLabel = nl ? "Totaal incl. btw" : "Total incl. VAT";
  const vatLabel = nl ? "waarvan btw" : "of which VAT";
  const viewMyItems = nl ? "Bekijk mijn items" : "View my items";
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;color:#444;">${escapeHtml(l.name)}${l.quantity > 1 ? ` × ${l.quantity}` : ""}</td><td style="padding:6px 0;text-align:right;color:#444;">${money(l.totalCents, currency)}</td></tr>`,
    )
    .join("");
  const html =
    emailParagraph(intro) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid #ececec;border-bottom:1px solid #ececec;">${rows}</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr><td style="font-weight:700;">${totalLabel}</td><td style="text-align:right;font-weight:700;">${money(totalCents, currency)}</td></tr></table>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#8a8d94;">${vatLabel}: ${money(vatCents, currency)}</p>` +
    emailButton(viewMyItems, myItemsUrl, branding.color);
  const text = [
    intro,
    "",
    ...lines.map((l) => `${l.name}${l.quantity > 1 ? ` x${l.quantity}` : ""} — ${money(l.totalCents, currency)}`),
    "",
    `${totalLabel}: ${money(totalCents, currency)}`,
    `${vatLabel}: ${money(vatCents, currency)}`,
    "",
    `${viewMyItems}: ${myItemsUrl}`,
  ].join("\n");
  const subject = nl ? `Je bon van ${branding.name} — ${orderNumber}` : `Your receipt from ${branding.name} — ${orderNumber}`;
  const preheader = nl ? `Bon voor ${orderNumber}` : `Receipt for ${orderNumber}`;
  return { subject, html: emailLayout({ branding, preheader, bodyHtml: html, locale }), text };
}

export function refundConfirmationEmail(params: {
  branding: EmailBranding;
  firstName: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  fully: boolean;
  locale: AppLocale;
}): EmailTemplate {
  const { branding, firstName, orderNumber, amountCents, currency, fully, locale } = params;
  const nl = locale === "nl";
  const line = nl
    ? `${fully ? "Je hebt" : "Je hebt gedeeltelijk"} ${money(amountCents, currency)} terugbetaald gekregen voor bestelling ${orderNumber}.`
    : `${fully ? "You've been refunded" : "You've been partly refunded"} ${money(amountCents, currency)} for order ${orderNumber}.`;
  const note = nl
    ? "Het kan een paar dagen duren voordat het op je bank- of betaalkaart staat, afhankelijk van je bank."
    : "It can take a few days to reach your bank or card, depending on your bank.";
  const html = emailParagraph(`${greeting(locale, firstName)} ${line}`) + emailParagraph(note);
  const text = [`${greeting(locale, firstName)} ${line}`, "", note].join("\n");
  const subject = nl ? `Terugbetaling bevestigd — ${orderNumber}` : `Refund confirmed — ${orderNumber}`;
  return { subject, html: emailLayout({ branding, preheader: line, bodyHtml: html, locale }), text };
}

// ------------------------------------------------------------------ auth

export function passwordResetEmail(params: { branding: EmailBranding; resetUrl: string; locale: AppLocale }): EmailTemplate {
  const { branding, resetUrl, locale } = params;
  const nl = locale === "nl";
  const intro = nl ? `Er is een verzoek gedaan om het wachtwoord voor ${branding.name} te resetten.` : `Someone asked to reset the password for ${branding.name}.`;
  const instructions = nl ? "Kies hier een nieuw wachtwoord. De link werkt eenmalig, gedurende een uur." : "Choose a new password here. The link works once, for one hour.";
  const buttonLabel = nl ? "Wachtwoord resetten" : "Reset password";
  const ignoreNote = nl
    ? "Als jij dit niet was, kun je deze e-mail negeren — je wachtwoord blijft hetzelfde."
    : "If this wasn't you, ignore this email and your password stays the same.";
  const html =
    emailParagraph(intro) +
    emailParagraph(instructions) +
    emailButton(buttonLabel, resetUrl, branding.color) +
    `<p style="margin:0;font-size:13px;color:#8a8d94;">${ignoreNote}</p>`;
  const text = [intro, "", `${instructions}:`, resetUrl, "", ignoreNote].join("\n");
  const subject = nl ? `Wachtwoord resetten voor ${branding.name}` : `Reset your password for ${branding.name}`;
  const preheader = nl ? "Wachtwoord resetten" : "Reset your password";
  return { subject, html: emailLayout({ branding, preheader, bodyHtml: html, locale }), text };
}

export function welcomeClientEmail(params: { branding: EmailBranding; firstName: string; openAppUrl: string; locale: AppLocale }): EmailTemplate {
  const { branding, firstName, openAppUrl, locale } = params;
  const nl = locale === "nl";
  const intro = nl ? `${greeting(locale, firstName)} je account bij ${branding.name} staat klaar.` : `${greeting(locale, firstName)} your account at ${branding.name} is ready.`;
  const body = nl
    ? "Boek behandelingen, spaar en besteed punten, en bewaar je bonnen — allemaal vanuit de app."
    : "Book treatments, earn and spend points, and keep your receipts — all from the app.";
  const buttonLabel = nl ? "Open de app" : "Open the app";
  const html = emailParagraph(intro) + emailParagraph(body) + emailButton(buttonLabel, openAppUrl, branding.color);
  const text = [intro, "", `${buttonLabel}: ${openAppUrl}`].join("\n");
  const subject = nl ? `Welkom bij ${branding.name}` : `Welcome to ${branding.name}`;
  return { subject, html: emailLayout({ branding, preheader: subject, bodyHtml: html, locale }), text };
}

export function welcomeClinicOwnerEmail(params: {
  branding: EmailBranding;
  ownerName: string;
  clinicName: string;
  loginUrl: string;
  locale: AppLocale;
}): EmailTemplate {
  const { branding, ownerName, clinicName, loginUrl, locale } = params;
  const nl = locale === "nl";
  const intro = nl ? `${greeting(locale, ownerName)} het portaal van ${clinicName} staat klaar.` : `${greeting(locale, ownerName)} ${clinicName}'s portal is ready.`;
  const body = nl
    ? "Stel hieronder je wachtwoord in, en je staat meteen in je dashboard."
    : "Set your password with the link below, then you're straight into your dashboard.";
  const buttonLabel = nl ? "Wachtwoord instellen en inloggen" : "Set your password and sign in";
  const html = emailParagraph(intro) + emailParagraph(body) + emailButton(buttonLabel, loginUrl, branding.color);
  const text = [intro, "", `${buttonLabel}: ${loginUrl}`].join("\n");
  const subject = nl ? `Welkom bij ${branding.name} — ${clinicName} staat klaar` : `Welcome to ${branding.name} — ${clinicName} is ready`;
  const preheader = nl ? `${clinicName} staat klaar` : `${clinicName} is ready`;
  return { subject, html: emailLayout({ branding, preheader, bodyHtml: html, locale }), text };
}

export function platformAdminInviteEmail(params: { branding: EmailBranding; firstName: string; loginUrl: string; locale: AppLocale }): EmailTemplate {
  const { branding, firstName, loginUrl, locale } = params;
  const nl = locale === "nl";
  const intro = nl
    ? `${greeting(locale, firstName)} je bent uitgenodigd als platformbeheerder bij ${branding.name}.`
    : `${greeting(locale, firstName)} you've been invited as a platform admin at ${branding.name}.`;
  const body = nl
    ? "Stel hieronder je wachtwoord in. De link werkt eenmalig, gedurende 24 uur. Daarna richt je meteen tweestapsverificatie in, verplicht voor dit account."
    : "Set your password with the link below. It works once, for 24 hours. You'll be asked to set up two-factor authentication right after — required for this account.";
  const buttonLabel = nl ? "Wachtwoord instellen" : "Set your password";
  const html = emailParagraph(intro) + emailParagraph(body) + emailButton(buttonLabel, loginUrl, branding.color);
  const text = [intro, "", body, "", `${buttonLabel}: ${loginUrl}`].join("\n");
  const subject = nl ? `Uitnodiging als platformbeheerder bij ${branding.name}` : `Invitation to be a platform admin at ${branding.name}`;
  const preheader = nl ? "Je bent uitgenodigd als platformbeheerder" : "You've been invited as a platform admin";
  return { subject, html: emailLayout({ branding, preheader, bodyHtml: html, locale }), text };
}

// ----------------------------------------------------------- memberships

export function membershipPaymentReceivedEmail(params: {
  branding: EmailBranding;
  firstName: string;
  planName: string;
  amountCents: number;
  currency: string;
  locale: AppLocale;
}): EmailTemplate {
  const { branding, firstName, planName, amountCents, currency, locale } = params;
  const nl = locale === "nl";
  const line = nl
    ? `Betaling ontvangen voor je ${planName} — ${money(amountCents, currency)}. Bedankt!`
    : `Payment received for your ${planName} — ${money(amountCents, currency)}. Thank you!`;
  const html = emailParagraph(`${greeting(locale, firstName)} ${line}`);
  const subject = nl ? `Betaling ontvangen — ${planName}` : `Payment received — ${planName}`;
  return {
    subject,
    html: emailLayout({ branding, preheader: line, bodyHtml: html, locale }),
    text: `${greeting(locale, firstName)} ${line}`,
  };
}

export function membershipPaymentFailedEmail(params: {
  branding: EmailBranding;
  firstName: string;
  planName: string;
  updatePaymentUrl: string;
  benefitsEndAt: string | null;
  locale: AppLocale;
}): EmailTemplate {
  const { branding, firstName, planName, updatePaymentUrl, benefitsEndAt, locale } = params;
  const nl = locale === "nl";
  const deadline = benefitsEndAt ? (nl ? ` Je voordelen blijven actief tot ${benefitsEndAt}.` : ` Your benefits continue until ${benefitsEndAt}.`) : "";
  const intro = nl
    ? `${greeting(locale, firstName)} we konden de betaling voor je ${planName} niet verwerken.`
    : `${greeting(locale, firstName)} we couldn't take the payment for your ${planName}.`;
  const body = nl ? `Werk je kaartgegevens bij om het te behouden.${deadline}` : `Update your card to keep it.${deadline}`;
  const buttonLabel = nl ? "Betaalmethode bijwerken" : "Update payment method";
  const html = emailParagraph(intro) + emailParagraph(body) + emailButton(buttonLabel, updatePaymentUrl, branding.color);
  const text = [intro, body, "", `${buttonLabel}: ${updatePaymentUrl}`].join("\n");
  const subject = nl ? `Actie vereist — betaling voor je ${planName} mislukt` : `Action needed — your ${planName} payment failed`;
  const preheader = nl ? "Je betaling is mislukt" : "Your payment failed";
  return { subject, html: emailLayout({ branding, preheader, bodyHtml: html, locale }), text };
}

export function membershipPriceChangeEmail(params: {
  branding: EmailBranding;
  firstName: string;
  planName: string;
  newPriceCents: number;
  currency: string;
  effectiveDate: string;
  manageUrl: string;
  locale: AppLocale;
}): EmailTemplate {
  const { branding, firstName, planName, newPriceCents, currency, effectiveDate, manageUrl, locale } = params;
  const nl = locale === "nl";
  const line = nl
    ? `${planName} wordt ${money(newPriceCents, currency)} vanaf ${effectiveDate}. Je kunt tot die tijd altijd nog opzeggen.`
    : `${planName} becomes ${money(newPriceCents, currency)} from ${effectiveDate}. You can cancel any time before then.`;
  const note = nl
    ? `Er verandert niets vóór ${effectiveDate}, en de betalingen tot die tijd blijven op de prijs waarop je bent aangemeld.`
    : `Nothing changes before ${effectiveDate}, and the payments until then stay at the price you signed up on.`;
  const buttonLabel = nl ? "Lidmaatschap beheren" : "Manage membership";
  const html = emailParagraph(`${greeting(locale, firstName)} ${line}`) + emailParagraph(note) + emailButton(buttonLabel, manageUrl, branding.color);
  const text = [`${greeting(locale, firstName)} ${line}`, "", note, "", `${buttonLabel}: ${manageUrl}`].join("\n");
  const subject = nl ? `De prijs van je ${planName} verandert` : `Your ${planName} price is changing`;
  return { subject, html: emailLayout({ branding, preheader: line, bodyHtml: html, locale }), text };
}

// --------------------------------------------------------- session packages

export function sessionsExpiringEmail(params: {
  branding: EmailBranding;
  firstName: string;
  packageName: string;
  sessions: number;
  endsOn: string;
  myItemsUrl: string;
  locale: AppLocale;
}): EmailTemplate {
  const { branding, firstName, packageName, sessions, endsOn, myItemsUrl, locale } = params;
  const nl = locale === "nl";
  const line = nl
    ? `Nog ${sessions} ${packageName}${sessions === 1 ? " sessie" : " sessies"} over — ze verlopen op ${endsOn}.`
    : `${sessions} ${packageName} session${sessions === 1 ? "" : "s"} left — they run out on ${endsOn}.`;
  const buttonLabel = nl ? "Bekijk mijn items" : "View my items";
  const html = emailParagraph(`${greeting(locale, firstName)} ${line}`) + emailButton(buttonLabel, myItemsUrl, branding.color);
  const subject = nl ? `${packageName}: sessies verlopen binnenkort` : `${packageName}: sessions expiring soon`;
  return {
    subject,
    html: emailLayout({ branding, preheader: line, bodyHtml: html, locale }),
    text: [`${greeting(locale, firstName)} ${line}`, "", `${buttonLabel}: ${myItemsUrl}`].join("\n"),
  };
}
