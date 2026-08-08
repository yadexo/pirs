import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CustomerRegisterForm } from "./register-form";

export default async function CustomerRegisterPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const businessName = tenant.branding?.businessName ?? tenant.name;

  return (
    <div className="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Create your {businessName} account</CardTitle>
          <CardDescription>Book appointments, earn rewards, and track your orders.</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerRegisterForm tenantSlug={tenantSlug} />
          <p className="mt-4 text-center text-sm text-ink-muted">
            Already have an account?{" "}
            <Link href={`/${tenantSlug}/login`} className="font-medium text-brand-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
