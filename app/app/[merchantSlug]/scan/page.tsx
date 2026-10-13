import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getRedeemableItems } from "@/lib/client-app-data";
import { getOwnedPackages } from "@/lib/client-app-packages";
import { clientNumberLabel } from "@/lib/client-number";
import { rawDb } from "@/lib/db";
import { ScanView } from "./scan-view";

export default async function ScanPage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  if (!ctx.customerProfileId) return null;

  const [summary, items, packages, agency] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getRedeemableItems(ctx.db, ctx.customerProfileId),
    getOwnedPackages(ctx.db, ctx.customerProfileId),
    // The platform's own white-label name, so a client's number is not
    // prefixed with a brand the clinic never agreed to.
    rawDb.agencySettings.findFirst({ select: { name: true } }),
  ]);
  if (!summary) return null;

  return (
    <ScanView
      firstName={summary.firstName}
      lastName={summary.lastName}
      clientNumber={clientNumberLabel(ctx.customerProfileId, agency?.name ?? "")}
      points={summary.loyaltyPoints}
      creditCents={summary.cashBalanceCents}
      currency={ctx.merchant.currency}
      // Sessions count here too: the desk spends them from this same code, so
      // the client should see what they are holding.
      readyItems={[
        ...packages
          .filter((p) => !p.expired && p.remainingUses > 0)
          .map((p) => ({ id: p.id, name: p.name, detail: p.sessionsLabel, imageUrl: p.imageUrl })),
        ...items.filter((i) => i.status === "AVAILABLE").map((i) => ({ id: i.id, name: i.name, detail: null, imageUrl: null })),
      ]}
    />
  );
}
