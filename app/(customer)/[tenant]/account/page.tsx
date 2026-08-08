import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { Settings, ShoppingBag, CalendarDays, Gift } from "lucide-react";
import { ProfileForm } from "./profile-form";

export default async function AccountPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
  if (!profile) notFound();

  const quickLinks = [
    { href: `/${tenantSlug}/orders`, label: "Orders", icon: ShoppingBag },
    { href: `/${tenantSlug}/appointments`, label: "Appointments", icon: CalendarDays },
    { href: `/${tenantSlug}/loyalty`, label: "Rewards", icon: Gift },
    { href: `/${tenantSlug}/account/settings`, label: "Settings", icon: Settings },
  ];

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Profile</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {quickLinks.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-surface-raised p-3 text-center hover:bg-surface-subtle">
            <Icon className="h-5 w-5 text-brand-primary" />
            <span className="text-xs font-medium">{label}</span>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="flex items-center justify-between p-4 text-sm">
          <span className="text-ink-muted">Account credit</span>
          <span className="font-semibold">{formatMoney(profile.accountCreditBalanceCents)}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm tenantSlug={tenantSlug} profile={profile} />
        </CardContent>
      </Card>
    </div>
  );
}
