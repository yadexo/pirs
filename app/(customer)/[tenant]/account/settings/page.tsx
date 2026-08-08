import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/lib/actions/session";
import { Button } from "@/components/ui/button";
import { PreferencesForm } from "./settings-form";

export default async function AccountSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
  if (!profile) notFound();

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Notification preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <PreferencesForm profile={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {tenant.branding?.termsContent && <p className="text-ink-muted">Terms &amp; conditions available from the clinic.</p>}
          {tenant.branding?.privacyContent && <p className="text-ink-muted">Privacy policy available from the clinic.</p>}
          {tenant.branding?.cancellationPolicy && <p className="text-ink-muted">Cancellation policy: {tenant.branding.cancellationPolicy}</p>}
        </CardContent>
      </Card>

      <form action={signOutAction}>
        <Button variant="outline" className="w-full" type="submit">
          Sign out
        </Button>
      </form>
    </div>
  );
}
