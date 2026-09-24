/**
 * Says why a clinic can't take card payments yet — and whether that's Stripe's
 * answer or our own stale copy of it.
 *
 *   npx tsx prisma/stripe-account-status.ts --clinic testclinic
 *   npx tsx prisma/stripe-account-status.ts --clinic testclinic --sync
 *
 * Read-only by default: it prints what our database holds, what Stripe says
 * right now, and which of the two is behind. With --sync it stores Stripe's
 * answer through exactly the same code path as the account.updated webhook,
 * which is the fix when the webhook never arrived.
 */
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { rawDb } from "../lib/db";
import { deriveStripeStatus, syncClinicFromAccount } from "../lib/stripe-status";
import { AdminSetupError, arg, ask, describeDatabase, exitWith, flag } from "./admin-cli";

export interface StatusReport {
  clinic: string;
  accountId: string;
  stored: { status: string; chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean; checkedAt: Date | null };
  live: { status: string; chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean; disabledReason: string | null; currentlyDue: string[]; pastDue: string[]; pendingVerification: string[] };
  /** Our stored status disagrees with what Stripe says now. */
  stale: boolean;
}

export function buildReport(clinicName: string, stored: StoredStripe, account: Stripe.Account): StatusReport {
  const live = deriveStripeStatus(account);
  const req = account.requirements ?? null;
  return {
    clinic: clinicName,
    accountId: account.id,
    stored: {
      status: stored.stripeStatus,
      chargesEnabled: stored.stripeChargesEnabled,
      detailsSubmitted: stored.stripeDetailsSubmitted,
      payoutsEnabled: stored.stripePayoutsEnabled,
      checkedAt: stored.stripeStatusCheckedAt,
    },
    live: {
      status: live,
      chargesEnabled: Boolean(account.charges_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      payoutsEnabled: Boolean(account.payouts_enabled),
      disabledReason: req?.disabled_reason ?? null,
      currentlyDue: req?.currently_due ?? [],
      pastDue: req?.past_due ?? [],
      pendingVerification: req?.pending_verification ?? [],
    },
    stale: live !== stored.stripeStatus || Boolean(account.charges_enabled) !== stored.stripeChargesEnabled,
  };
}

/** One sentence naming what is actually blocking card payments. */
export function verdict(report: StatusReport): string {
  const { stored, live, stale } = report;
  if (live.chargesEnabled && stale)
    return "Stripe has enabled card payments on this account. Our database is behind — the account.updated webhook never reached us. Re-run with --sync to store Stripe's answer.";
  if (live.chargesEnabled) return "Stripe has enabled card payments and our database agrees. Checkout should work.";
  if (!live.detailsSubmitted) return "Onboarding was never finished on Stripe's side (details_submitted is false). The owner has to complete the form again.";
  if (live.pastDue.length) return `Stripe is blocking charges until these are provided: ${live.pastDue.join(", ")}.`;
  if (live.currentlyDue.length) return `Stripe is waiting on information from the clinic: ${live.currentlyDue.join(", ")}.`;
  if (live.pendingVerification.length) return `Stripe is still verifying: ${live.pendingVerification.join(", ")}. Nothing to do but wait.`;
  if (live.disabledReason) return `Stripe has charges disabled, reason "${live.disabledReason}".`;
  return `Stripe has not enabled charges yet and lists no outstanding requirements${stale ? `, and our stored status (${stored.status}) is out of date` : ""}. This is Stripe still reviewing the account.`;
}

type StoredStripe = {
  stripeAccountId: string | null;
  stripeStatus: string;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeStatusCheckedAt: Date | null;
};

function print(report: StatusReport) {
  const yesNo = (v: boolean) => (v ? "yes" : "no");
  console.log(`\nClinic:          ${report.clinic}`);
  console.log(`Stripe account:  ${report.accountId}`);
  console.log(`\nOur database:    ${report.stored.status}  (charges ${yesNo(report.stored.chargesEnabled)}, form submitted ${yesNo(report.stored.detailsSubmitted)}, payouts ${yesNo(report.stored.payoutsEnabled)})`);
  console.log(`Last synced:     ${report.stored.checkedAt ? report.stored.checkedAt.toISOString() : "never"}`);
  console.log(`\nStripe says:     ${report.live.status}  (charges ${yesNo(report.live.chargesEnabled)}, form submitted ${yesNo(report.live.detailsSubmitted)}, payouts ${yesNo(report.live.payoutsEnabled)})`);
  console.log(`  disabled_reason:      ${report.live.disabledReason ?? "(none)"}`);
  console.log(`  currently_due:        ${report.live.currentlyDue.join(", ") || "(none)"}`);
  console.log(`  past_due:             ${report.live.pastDue.join(", ") || "(none)"}`);
  console.log(`  pending_verification: ${report.live.pendingVerification.join(", ") || "(none)"}`);
  console.log(`\n${verdict(report)}\n`);
}

async function main() {
  const slug = (arg("clinic") ?? (await ask("Clinic address (e.g. testclinic): "))).trim().toLowerCase();
  if (!process.env.STRIPE_SECRET_KEY) {
    // Prompted, not typed as an argument: a secret key in shell history is a secret leaked.
    process.env.STRIPE_SECRET_KEY = (await ask("Stripe secret key (input hidden): ", { hidden: true })).trim();
  }
  if (!process.env.STRIPE_SECRET_KEY) throw new AdminSetupError("No Stripe secret key given. Nothing was read.");
  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);

  const clinic = await rawDb.tenant.findUnique({
    where: { slug },
    select: {
      name: true,
      stripeAccountId: true,
      stripeStatus: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
      stripeStatusCheckedAt: true,
    },
  });
  if (!clinic) throw new AdminSetupError(`There is no clinic with the address "${slug}".`);
  if (!clinic.stripeAccountId) throw new AdminSetupError(`${clinic.name} has no Stripe account connected at all (status ${clinic.stripeStatus}).`);

  // GET /v1/accounts/:id, which Stripe answers in the v1 shape for v2 accounts too.
  const account = await new Stripe(process.env.STRIPE_SECRET_KEY).accounts.retrieve(clinic.stripeAccountId);
  const report = buildReport(clinic.name, clinic as StoredStripe, account);
  print(report);

  if (flag("sync")) {
    const changed = await syncClinicFromAccount(account);
    console.log(changed ? `Stored Stripe's answer: ${report.live.status}.` : "Nothing to store — our database was already newer.");
  } else if (report.stale) {
    console.log("Nothing was changed. Re-run with --sync to store Stripe's answer.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(exitWith)
    .finally(() => rawDb.$disconnect());
}
