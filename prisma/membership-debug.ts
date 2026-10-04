/**
 * Why a member did or didn't get their member price. Reads only.
 *
 *   npx tsx prisma/membership-debug.ts --clinic testclinic2
 *   npx tsx prisma/membership-debug.ts --clinic testclinic2 --item "Bleken Sessie"
 *
 * Prints each plan's two rates next to what they actually cover, each
 * member's status and whether that status still earns benefits today, and —
 * with --item — what the real resolver works out for a basket holding exactly
 * that one thing. That last line is the answer: it is the same function
 * checkout calls, so if it says zero, zero is what the client was charged.
 *
 * A plan's treatment rate never touches a product and its product rate never
 * touches a treatment, which is the usual reason a member sees a member price
 * advertised and then pays the full one.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { membershipCandidates, bestDiscount, type BasketLine } from "../lib/discounts";
import { membershipGivesBenefits, MEMBERSHIP_HOLDS_SLOT } from "../lib/membership-status";
import { AdminSetupError, arg, describeDatabase, exitWith } from "./admin-cli";

export interface MembershipDebugReport {
  clinic: string;
  plans: {
    name: string;
    active: boolean;
    priceCents: number;
    includedCreditCents: number;
    serviceDiscountPercent: number | null;
    productDiscountPercent: number | null;
    /** What those rates actually discount, in the words the code uses. */
    covers: string;
  }[];
  members: {
    who: string;
    plan: string;
    status: string;
    pastDueSince: string | null;
    benefitsNow: boolean;
    creditCents: number;
    /** The candidates the resolver builds for this member, by kind. */
    candidates: { kind: string; percent: number }[];
  }[];
  item?: {
    name: string;
    kind: "SERVICE" | "PRODUCT";
    priceCents: number;
    /** Per member: what the resolver takes off a basket of just this item. */
    outcomes: { who: string; discountCents: number; source: string | null; title: string | null }[];
  };
}

export async function membershipDebug(db: PrismaClient, clinicSlug: string, itemName?: string, now = new Date()): Promise<MembershipDebugReport> {
  const clinic = await db.tenant.findUnique({ where: { slug: clinicSlug }, select: { id: true, name: true } });
  if (!clinic) throw new AdminSetupError(`No clinic with the address "${clinicSlug}".`);

  const plans = await db.membershipPlan.findMany({
    where: { tenantId: clinic.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      active: true,
      priceCents: true,
      includedCreditCents: true,
      serviceDiscountPercent: true,
      productDiscountPercent: true,
    },
  });

  const memberships = await db.customerMembership.findMany({
    where: { tenantId: clinic.id, status: { in: [...MEMBERSHIP_HOLDS_SLOT] } },
    orderBy: { startedAt: "desc" },
    select: {
      status: true,
      pastDueSince: true,
      customerProfile: { select: { id: true, firstName: true, lastName: true, accountCreditBalanceCents: true, user: { select: { email: true } } } },
      membershipPlan: { select: { id: true, name: true, serviceDiscountPercent: true, productDiscountPercent: true } },
    },
  });

  const covers = (plan: { serviceDiscountPercent: number | null; productDiscountPercent: number | null }) => {
    const parts: string[] = [];
    if (plan.serviceDiscountPercent) parts.push(`${plan.serviceDiscountPercent}% off treatments`);
    if (plan.productDiscountPercent) parts.push(`${plan.productDiscountPercent}% off products`);
    return parts.length > 0 ? parts.join(", ") : "nothing — neither rate is set";
  };

  const report: MembershipDebugReport = {
    clinic: `${clinic.name} (${clinicSlug})`,
    plans: plans.map((p) => ({ ...p, covers: covers(p) })),
    members: memberships.map((m) => {
      const profile = m.customerProfile;
      return {
        who: `${[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "—"} <${profile?.user?.email ?? "no email"}>`,
        plan: m.membershipPlan?.name ?? "—",
        status: m.status,
        pastDueSince: m.pastDueSince?.toISOString() ?? null,
        benefitsNow: membershipGivesBenefits(m, now),
        creditCents: profile?.accountCreditBalanceCents ?? 0,
        candidates: membershipCandidates(m).map((c) => ({ kind: c.appliesToKind ?? "everything", percent: c.discountValue })),
      };
    }),
  };

  if (itemName) {
    const service = await db.service.findFirst({ where: { tenantId: clinic.id, name: itemName }, select: { id: true, name: true, priceCents: true, categoryId: true } });
    const product = service
      ? null
      : await db.product.findFirst({ where: { tenantId: clinic.id, name: itemName }, select: { id: true, name: true, priceCents: true, categoryId: true } });
    const found = service ?? product;
    if (!found) throw new AdminSetupError(`No treatment or product called "${itemName}" at this clinic.`);

    const line: BasketLine = {
      kind: service ? "SERVICE" : "PRODUCT",
      id: found.id,
      categoryId: found.categoryId,
      unitPriceCents: found.priceCents,
      quantity: 1,
    };

    report.item = {
      name: found.name,
      kind: line.kind,
      priceCents: found.priceCents,
      outcomes: memberships.map((m) => {
        const candidates = membershipGivesBenefits(m, now) ? membershipCandidates(m) : [];
        const best = bestDiscount([line], candidates);
        const profile = m.customerProfile;
        return {
          who: `${[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "—"}`,
          discountCents: best?.discountCents ?? 0,
          source: best?.source ?? null,
          title: best?.title ?? null,
        };
      }),
    };
  }

  return report;
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function print(report: MembershipDebugReport) {
  console.log(`\n${report.clinic}`);

  console.log(`\nPlans (${report.plans.length})`);
  for (const p of report.plans) {
    console.log(`  ${p.active ? "live    " : "inactive"} ${p.name} — ${money(p.priceCents)} per period, ${money(p.includedCreditCents)} credit included`);
    console.log(`           treatments: ${p.serviceDiscountPercent ?? "not set"}   products: ${p.productDiscountPercent ?? "not set"}`);
    console.log(`           so it discounts ${p.covers}`);
  }

  console.log(`\nMembers (${report.members.length})`);
  for (const m of report.members) {
    console.log(`  ${m.status.padEnd(10)} ${m.who}`);
    console.log(`             plan ${m.plan}, credit ${money(m.creditCents)}, benefits right now: ${m.benefitsNow ? "yes" : "NO"}`);
    if (m.pastDueSince) console.log(`             past due since ${m.pastDueSince}`);
    console.log(
      `             discounts offered: ${m.candidates.length === 0 ? "none" : m.candidates.map((c) => `${c.percent}% on ${c.kind}`).join(", ")}`,
    );
  }

  if (report.item) {
    const i = report.item;
    console.log(`\n"${i.name}" is a ${i.kind === "SERVICE" ? "treatment" : "product"}, listed at ${money(i.priceCents)}`);
    console.log("  What the resolver takes off a basket of just this item:");
    for (const o of i.outcomes) {
      console.log(`    ${o.discountCents > 0 ? `−${money(o.discountCents)}` : "nothing"}${o.title ? `  (${o.title}, ${o.source})` : ""}   ${o.who}`);
    }
    console.log(
      `\n  A plan's treatment rate only discounts treatments and its product rate only discounts products. If the rate above is set on the other kind, that is why this item is charged in full.`,
    );
  }
  console.log("");
}

async function main() {
  const clinicSlug = arg("clinic");
  if (!clinicSlug) throw new AdminSetupError("Which clinic? Pass --clinic <address>, e.g. --clinic testclinic2.");

  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);
  const db = new PrismaClient();
  try {
    print(await membershipDebug(db, clinicSlug, arg("item")));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
