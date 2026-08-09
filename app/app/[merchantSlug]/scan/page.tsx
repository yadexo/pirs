import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary } from "@/lib/client-app-data";
import { ScanCard } from "./scan-card";

export default async function ScanPage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  // The layout renders onboarding when logged out, but Next renders page
  // and layout in parallel — so this page must guard independently.
  if (!ctx.customerProfileId) return null;
  const summary = await getClientSummary(ctx.db, ctx.customerProfileId);
  if (!summary) return null;

  return (
    <ScanCard
      firstName={summary.firstName}
      joinedDaysAgo={summary.joinedDaysAgo}
      isMember={summary.isMember}
    />
  );
}
