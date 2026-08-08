import Link from "next/link";
import { requireStaffContext, requireRole } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsForm } from "./settings-form";

function integrationStatus(envVar: string | undefined, provider: string) {
  return envVar ? (
    <Badge tone="success">{provider} connected</Badge>
  ) : (
    <Badge tone="neutral">{provider} — mock mode</Badge>
  );
}

export default async function AdminSettingsPage() {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  const settings = await db.tenantSettings.findFirst({ where: {} });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Business settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Taxes & appointment rules</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Payments</span>
            {integrationStatus(process.env.PAYMENT_PROVIDER === "stripe" ? "1" : undefined, "Stripe")}
          </div>
          <div className="flex items-center justify-between">
            <span>Email</span>
            {integrationStatus(process.env.EMAIL_PROVIDER === "resend" ? "1" : undefined, "Resend")}
          </div>
          <div className="flex items-center justify-between">
            <span>SMS</span>
            {integrationStatus(process.env.SMS_PROVIDER === "twilio" ? "1" : undefined, "Twilio")}
          </div>
          <div className="flex items-center justify-between">
            <span>Push notifications</span>
            {integrationStatus(process.env.PUSH_PROVIDER === "webpush" ? "1" : undefined, "Web Push")}
          </div>
          <p className="pt-2 text-xs text-ink-subtle">
            Configure real credentials in your environment variables — see the README for setup instructions.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>More settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin/locations" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-subtle">
            Locations & opening hours
          </Link>
          <Link href="/admin/staff/roles" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-subtle">
            Staff permissions
          </Link>
          <Link href="/admin/loyalty" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-subtle">
            Loyalty rules
          </Link>
          <Link href="/admin/branding" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-subtle">
            Branding & legal documents
          </Link>
          <Link href="/admin/audit-log" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-subtle">
            Audit log
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
