import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary } from "@/lib/client-app-data";
import { ScanView } from "./scan-view";

export default async function ScanPage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  if (!ctx.customerProfileId) return null;

  const summary = await getClientSummary(ctx.db, ctx.customerProfileId);
  if (!summary) return null;

  return (
    <ScanView
      merchantSlug={merchantSlug}
      firstName={summary.firstName}
      lastName={summary.lastName}
      joinedDaysAgo={summary.joinedDaysAgo}
      isMember={summary.isMember}
    />
  );
}
