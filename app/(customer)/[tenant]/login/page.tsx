import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CustomerLoginForm } from "./login-form";

export default async function CustomerLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { next } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const businessName = tenant.branding?.businessName ?? tenant.name;

  return (
    <div className="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Sign in to {businessName}</CardTitle>
          <CardDescription>Access your account, appointments, and rewards.</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerLoginForm tenantSlug={tenantSlug} next={next} />
          <p className="mt-4 text-center text-sm text-ink-muted">
            New here?{" "}
            <Link href={`/${tenantSlug}/register`} className="font-medium text-brand-primary hover:underline">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
