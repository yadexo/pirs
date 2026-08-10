import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getRewardsData } from "@/lib/client-app-data";
import { RewardsView } from "./rewards-view";

export default async function RewardsPage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  if (!ctx.customerProfileId) return null;

  const [summary, data] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getRewardsData(ctx.db),
  ]);
  if (!summary) return null;

  return <RewardsView merchantSlug={merchantSlug} currency={ctx.merchant.currency} summary={summary} data={data} />;
}
