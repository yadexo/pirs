import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { MembershipControls } from "./client";

export default async function MembershipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { joined } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const session = await auth();
  const isAuthenticated = session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug;
  const db = getTenantDb(tenant.id);

  const plans = await db.membershipPlan.findMany({
    where: { active: true },
    include: { benefits: { include: { service: true } } },
    orderBy: { priceCents: "asc" },
  });

  const currentMembership = isAuthenticated
    ? await db.customerMembership.findFirst({
        where: {
          customerProfileId: session!.user.customerProfileId!,
          status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] },
        },
        include: { membershipPlan: true, billingEvents: { orderBy: { occurredAt: "desc" }, take: 5 } },
      })
    : null;

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Memberships</h1>

      {joined === "1" && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 text-sm text-success">You&apos;re now a member. Welcome!</CardContent>
        </Card>
      )}

      {currentMembership && (
        <Card>
          <CardHeader>
            <CardTitle>Your membership — {currentMembership.membershipPlan.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={currentMembership.status === "ACTIVE" ? "success" : "neutral"}>{currentMembership.status}</Badge>
              {currentMembership.nextBillingAt && (
                <span className="text-sm text-ink-muted">Next billing {formatDate(currentMembership.nextBillingAt)}</span>
              )}
            </div>
            <p className="text-sm text-ink-muted">Membership credit: {formatMoney(currentMembership.creditBalanceCents)}</p>
            <div>
              <p className="mb-1 text-sm font-medium">Billing history</p>
              {currentMembership.billingEvents.length === 0 ? (
                <p className="text-sm text-ink-subtle">No billing events yet.</p>
              ) : (
                <ul className="space-y-1 text-sm text-ink-muted">
                  {currentMembership.billingEvents.map((e) => (
                    <li key={e.id} className="flex justify-between">
                      <span>{e.description ?? e.type}</span>
                      <span>{formatDate(e.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {currentMembership.status !== "CANCELLED" && (
              <MembershipControls tenantSlug={tenantSlug} membershipId={currentMembership.id} paused={currentMembership.status === "PAUSED"} />
            )}
          </CardContent>
        </Card>
      )}

      {!currentMembership && (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <Link key={plan.id} href={`/${tenantSlug}/memberships/${plan.id}`}>
              <Card className="h-full transition-shadow hover:shadow-raised">
                <CardContent className="p-4">
                  <p className="font-medium">{plan.name}</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatMoney(plan.priceCents)}
                    <span className="text-sm font-normal text-ink-muted"> / {plan.billingFrequency === "MONTHLY" ? "mo" : "yr"}</span>
                  </p>
                  {plan.description && <p className="mt-1 text-sm text-ink-muted line-clamp-2">{plan.description}</p>}
                  {plan.benefits.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {plan.benefits.slice(0, 3).map((b) => (
                        <li key={b.id} className="flex items-center gap-1.5 text-xs text-ink-muted">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {b.service?.name ?? b.description}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
