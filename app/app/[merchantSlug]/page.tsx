import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getHomeData } from "@/lib/client-app-data";
import { HomeView } from "./home-view";

export default async function ClientHomePage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  // The layout renders onboarding when logged out, but Next renders page and
  // layout in parallel — so this page must guard independently.
  if (!ctx.customerProfileId) return null;

  const [summary, home] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getHomeData(ctx.db),
  ]);
  if (!summary) return null;

  return (
    <HomeView
      merchantSlug={merchantSlug}
      merchantName={ctx.merchant.name}
      currency={ctx.merchant.currency}
      summary={summary}
      home={home}
    />
  );
}
