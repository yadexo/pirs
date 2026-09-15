import "server-only";
import type { TenantDb } from "@/lib/tenant-db";

/**
 * Read models for the client app. Everything here is scoped to one merchant
 * and one client — no surface reads another client's data, and nothing is
 * hardcoded per clinic.
 */

export interface ClientSummary {
  firstName: string;
  lastName: string;
  phone: string | null;
  joinedDaysAgo: number;
  loyaltyPoints: number;
  cashBalanceCents: number;
  isMember: boolean;
  membershipPlanName: string | null;
  membershipPriceCents: number | null;
  membershipNextBillingAt: string | null;
  emailConsent: boolean;
  smsConsent: boolean;
  pushConsent: boolean;
  marketingConsent: boolean;
}

export async function getClientSummary(db: TenantDb, customerProfileId: string): Promise<ClientSummary | null> {
  const profile = await db.customerProfile.findFirst({
    where: { id: customerProfileId },
    include: {
      memberships: {
        where: { status: { in: ["ACTIVE", "TRIAL"] } },
        include: { membershipPlan: { select: { name: true, priceCents: true } } },
        take: 1,
      },
    },
  });
  if (!profile) return null;

  const membership = profile.memberships[0] ?? null;
  const joinedDaysAgo = Math.max(0, Math.floor((Date.now() - profile.createdAt.getTime()) / 86_400_000));

  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    joinedDaysAgo,
    loyaltyPoints: profile.loyaltyPointsBalance,
    cashBalanceCents: profile.accountCreditBalanceCents,
    isMember: !!membership,
    membershipPlanName: membership?.membershipPlan.name ?? null,
    membershipPriceCents: membership?.membershipPlan.priceCents ?? null,
    membershipNextBillingAt: membership?.nextBillingAt?.toISOString() ?? null,
    emailConsent: profile.emailConsent,
    smsConsent: profile.smsConsent,
    pushConsent: profile.pushConsent,
    marketingConsent: profile.marketingConsent,
  };
}

export interface HomeData {
  payLaterEnabled: boolean;
  offers: { id: string; title: string; description: string | null; endsAt: string; imageUrl: string | null; code: string | null }[];
  locations: { id: string; name: string; address: string; phone: string | null }[];
  hasPlans: boolean;
}

export async function getHomeData(db: TenantDb): Promise<HomeData> {
  const now = new Date();
  const [settings, offers, locations, plan] = await Promise.all([
    db.tenantSettings.findFirst({ where: {} }),
    db.promotion.findMany({
      where: { active: true, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { endAt: "asc" },
      take: 8,
    }),
    db.location.findMany({ where: { active: true }, orderBy: { isPrimary: "desc" } }),
    db.membershipPlan.findFirst({ where: { active: true }, orderBy: { priceCents: "asc" }, select: { name: true } }),
  ]);

  return {
    payLaterEnabled: settings?.payLaterEnabled ?? false,
    offers: offers.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      endsAt: o.endAt.toISOString(),
      imageUrl: o.imageUrl,
      code: o.code,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: [l.addressLine1, l.city, l.postalCode].filter(Boolean).join(", "),
      phone: l.phone,
    })),
    hasPlans: !!plan,
  };
}

export interface RewardsData {
  rewards: { id: string; name: string; description: string | null; pointsCost: number }[];
  /** `url` is where a row sends the client (e.g. the clinic's Google review page). */
  earnRules: { key: string; title: string; subtitle: string | null; badge: string; url?: string }[];
}

export async function getRewardsData(db: TenantDb, currency: string): Promise<RewardsData> {
  const [rewards, programme, settings] = await Promise.all([
    db.loyaltyReward.findMany({ where: { active: true }, orderBy: { pointsCost: "asc" } }),
    db.loyaltyProgramme.findFirst({ where: {} }),
    db.tenantSettings.findFirst({ where: {}, select: { googleReviewUrl: true } }),
  ]);
  const unit = new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: 0 }).format(1);

  // "Need more points?" rows are driven by the loyalty rules the merchant
  // configured — a rule worth zero points is not shown.
  const earnRules: RewardsData["earnRules"] = [];
  if (programme?.active) {
    if (programme.referralPoints > 0) {
      earnRules.push({ key: "referral", title: "Refer a friend", subtitle: null, badge: `+${programme.referralPoints} Points` });
    }
    if (programme.pointsPerCents > 0) {
      const perUnit = Math.round(programme.pointsPerCents * 100);
      earnRules.push({
        key: "purchase",
        title: "Purchase in-app",
        subtitle: `${perUnit} point${perUnit === 1 ? "" : "s"} per ${unit} spent`,
        badge: `+${perUnit} Point${perUnit === 1 ? "" : "s"}`,
      });
    }
    if (programme.pointsPerVisit > 0) {
      earnRules.push({ key: "visit", title: "Visit our clinic", subtitle: null, badge: `+${programme.pointsPerVisit} Points` });
    }
    if (programme.reviewPoints > 0 && settings?.googleReviewUrl) {
      earnRules.push({ key: "review", title: "Review us on Google", subtitle: null, badge: `+${programme.reviewPoints} Points`, url: settings.googleReviewUrl });
    }
    if (programme.birthdayPoints > 0) {
      earnRules.push({ key: "birthday", title: "Birthday bonus", subtitle: null, badge: `+${programme.birthdayPoints} Points` });
    }
  }

  return {
    rewards: rewards.map((r) => ({ id: r.id, name: r.name, description: r.description, pointsCost: r.pointsCost })),
    earnRules,
  };
}
