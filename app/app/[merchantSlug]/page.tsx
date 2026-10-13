import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary } from "@/lib/client-app-data";
import { getHomeSections } from "@/lib/client-app-home";
import { HomeView } from "./home-view";

export default async function ClientHomePage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  // The layout renders onboarding when logged out, but Next renders page and
  // layout in parallel — so this page must guard independently.
  if (!ctx.customerProfileId) return null;

  const [summary, sections] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getHomeSections(ctx.db, { tenantId: ctx.merchant.id, customerProfileId: ctx.customerProfileId }),
  ]);
  if (!summary) return null;

  return (
    <HomeView
      merchantSlug={merchantSlug}
      merchantName={ctx.merchant.name}
      logoUrl={ctx.merchant.logoUrl}
      currency={ctx.merchant.currency}
      summary={summary}
      sections={sections}
    />
  );
}
