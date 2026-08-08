import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { JoinButton } from "../client";

export default async function MembershipPlanDetailPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: tenantSlug, id } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const db = getTenantDb(tenant.id);
  const plan = await db.membershipPlan.findFirst({ where: { id, active: true }, include: { benefits: { include: { service: true } } } });
  if (!plan) notFound();

  const session = await auth();
  const isAuthenticated = session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug;

  return (
    <div className="space-y-4 py-4">
      <div>
        <h1 className="text-xl font-semibold">{plan.name}</h1>
        <p className="mt-1 text-2xl font-semibold">
          {formatMoney(plan.priceCents)}
          <span className="text-sm font-normal text-ink-muted"> / {plan.billingFrequency === "MONTHLY" ? "mo" : "yr"}</span>
        </p>
      </div>

      {plan.description && (
        <Card>
          <CardContent className="p-4 text-sm text-ink-muted">{plan.description}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-sm font-medium">What&apos;s included</p>
          {plan.includedCreditCents > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 text-success" /> {formatMoney(plan.includedCreditCents)} account credit each period
            </p>
          )}
          {plan.serviceDiscountPercent ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 text-success" /> {plan.serviceDiscountPercent}% off services
            </p>
          ) : null}
          {plan.productDiscountPercent ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 text-success" /> {plan.productDiscountPercent}% off products
            </p>
          ) : null}
          {plan.priorityAccess && (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 text-success" /> Priority booking access
            </p>
          )}
          {plan.benefits.map((b) => (
            <p key={b.id} className="flex items-center gap-1.5 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 text-success" /> {b.service?.name ?? b.description}
            </p>
          ))}
        </CardContent>
      </Card>

      {plan.cancellationPolicy && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium">Cancellation policy</p>
            <p className="mt-1 text-sm text-ink-muted">{plan.cancellationPolicy}</p>
          </CardContent>
        </Card>
      )}

      <JoinButton
        tenantSlug={tenantSlug}
        planId={plan.id}
        isAuthenticated={!!isAuthenticated}
        loginHref={`/${tenantSlug}/login?next=/${tenantSlug}/memberships/${id}`}
      />
    </div>
  );
}
