import type { Metadata, Viewport } from "next";
import { getClientAppContext } from "@/lib/client-app-context";
import { headers } from "next/headers";
import { clientBasePath, getPublicClinic, shortAppName } from "@/lib/public-clinic";
import { InstallPrompt, ServiceWorker } from "@/components/client-app/pwa";
import { getClientSummary, getRewardsData } from "@/lib/client-app-data";
import { Onboarding } from "./onboarding";
import { ClientAppShell } from "./shell";
import "./client-app.css";

type Params = { params: Promise<{ merchantSlug: string }> };

/**
 * Makes each clinic's app installable on its own: Add to Home Screen uses this
 * clinic's name and uploaded icon, and opens full-screen straight into it.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { merchantSlug } = await params;
  const clinic = await getPublicClinic(merchantSlug);
  if (!clinic) return {};
  const requestHeaders = await headers();
  const base = clientBasePath(clinic.slug, requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"));
  const v = `?v=${clinic.version}`;
  return {
    title: clinic.name,
    description: `${clinic.name} — bookings, rewards and membership.`,
    manifest: `${base}/manifest.webmanifest`,
    icons: {
      icon: [{ url: `${base}/app-icon/192.png${v}`, sizes: "192x192", type: "image/png" }],
      apple: [{ url: `${base}/app-icon/180.png${v}`, sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: { capable: true, title: shortAppName(clinic.name), statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#f4f5f7",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default async function ClientAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);

  // The merchant's own brand colour is the only colour the client app takes
  // from configuration; everything else is the fixed monochrome palette.
  const style = ctx.merchant.accentColor
    ? ({ "--merchant-accent": ctx.merchant.accentColor } as React.CSSProperties)
    : undefined;

  if (!ctx.customerProfileId) {
    return (
      <div className="client-app" style={style}>
        <Onboarding merchantSlug={merchantSlug} merchantName={ctx.merchant.name} logoUrl={ctx.merchant.logoUrl} />
        <ServiceWorker />
      </div>
    );
  }

  const [summary, rewards] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getRewardsData(ctx.db, ctx.merchant.currency),
  ]);

  // Dot on the Rewards tab when something just became affordable.
  const rewardsDot = !!summary && rewards.rewards.some((r) => r.pointsCost <= summary.loyaltyPoints);

  return (
    <div className="client-app" style={style}>
      <ClientAppShell
        merchantSlug={merchantSlug}
        merchantName={ctx.merchant.name}
        logoUrl={ctx.merchant.logoUrl}
        currency={ctx.merchant.currency}
        rewardsDot={rewardsDot}
      >
        {children}
      </ClientAppShell>
      <ServiceWorker />
      <InstallPrompt merchantSlug={merchantSlug} merchantName={ctx.merchant.name} />
    </div>
  );
}
