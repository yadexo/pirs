/**
 * Registers the checkout domains for Apple Pay on clinics that connected
 * Stripe before this existed. New clinics are done automatically, by the
 * account.updated webhook, the moment Stripe enables their charges.
 *
 *   npx tsx prisma/register-apple-pay-domains.ts                      # every live clinic
 *   npx tsx prisma/register-apple-pay-domains.ts --clinic testclinic  # just one
 *
 * Only touches Stripe — no clinic record is changed. Re-running is harmless:
 * a domain already on an account is left alone.
 */
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { rawDb } from "../lib/db";
import { checkoutDomains, domainsApi, registerApplePayDomains } from "../lib/apple-pay-domains";
import { AdminSetupError, arg, ask, confirmOrCancel, describeDatabase, exitWith } from "./admin-cli";

async function main() {
  const slug = arg("clinic")?.trim().toLowerCase();
  const domains = checkoutDomains();
  if (domains.length === 0) {
    throw new AdminSetupError("No checkout domains to register. Set CLIENT_APP_URL and APP_URL (or APPLE_PAY_DOMAINS) and try again.");
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    // Prompted, not passed as an argument: a secret key in shell history is a secret leaked.
    process.env.STRIPE_SECRET_KEY = (await ask("Stripe secret key (input hidden): ", { hidden: true })).trim();
  }
  if (!process.env.STRIPE_SECRET_KEY) throw new AdminSetupError("No Stripe secret key given. Nothing was changed.");

  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);
  const clinics = await rawDb.tenant.findMany({
    where: { stripeChargesEnabled: true, stripeAccountId: { not: null }, ...(slug ? { slug } : {}) },
    select: { name: true, slug: true, stripeAccountId: true },
    orderBy: { name: "asc" },
  });
  if (clinics.length === 0) {
    throw new AdminSetupError(
      slug ? `Clinic "${slug}" either doesn't exist or can't take card payments yet, so there is nothing to register.` : "No clinic has Stripe charges enabled yet, so there is nothing to register.",
    );
  }

  await confirmOrCancel(`About to register ${domains.join(", ")} for Apple Pay on ${clinics.length} clinic account(s): ${clinics.map((c) => c.slug).join(", ")}`);

  const api = domainsApi(new Stripe(process.env.STRIPE_SECRET_KEY));
  let failures = 0;
  for (const clinic of clinics) {
    const results = await registerApplePayDomains(api, clinic.stripeAccountId!, domains);
    const summary = results.map((r) => `${r.domain}: ${r.status === "failed" ? `failed — ${r.error}` : r.status}`).join("; ");
    failures += results.filter((r) => r.status === "failed").length;
    console.log(`${clinic.name} (${clinic.slug}) — ${summary}`);
  }
  console.log(failures === 0 ? "\nAll domains are registered. No clinic record was changed." : `\n${failures} registration(s) failed; the rest are done. No clinic record was changed.`);
  if (failures > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(exitWith)
    .finally(() => rawDb.$disconnect());
}
