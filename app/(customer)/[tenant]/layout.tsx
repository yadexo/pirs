import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { CustomerTopBar } from "@/components/customer/top-bar";
import { CustomerBottomNav } from "@/components/customer/bottom-nav";

export default async function CustomerTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const session = await auth();
  const isAuthenticated =
    session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug && !!session.user.customerProfileId;

  let basketCount = 0;
  let unreadNotifications = 0;

  if (isAuthenticated && session) {
    const db = getTenantDb(tenant.id);
    const [basket, unread] = await Promise.all([
      db.basket.findFirst({
        where: { customerProfileId: session.user.customerProfileId!, status: "OPEN" },
        include: { items: true },
      }),
      db.notification.count({
        where: { customerProfileId: session.user.customerProfileId!, readAt: null },
      }),
    ]);
    basketCount = basket?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
    unreadNotifications = unread;
  }

  const branding = tenant.branding;

  return (
    <div
      style={
        branding
          ? ({
              "--brand-primary": branding.primaryColor,
              "--brand-secondary": branding.secondaryColor,
              "--brand-accent": branding.accentColor,
            } as React.CSSProperties)
          : undefined
      }
      className="flex min-h-screen flex-col"
    >
      <CustomerTopBar
        tenant={tenant}
        isAuthenticated={!!isAuthenticated}
        basketCount={basketCount}
        unreadNotifications={unreadNotifications}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-4 sm:pb-8">{children}</main>
      <CustomerBottomNav tenantSlug={tenantSlug} />
    </div>
  );
}
