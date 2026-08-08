import { Building2, Clock, TrendingUp, Users } from "lucide-react";
import { rawDb } from "@/lib/db";
import { requireAgencyContext } from "@/lib/merchant-context";
import { StatCard } from "@/components/ui/stat-card";
import { MerchantList } from "./merchant-list";
import { AddMerchantButton } from "./add-merchant";

export default async function AgencyHomePage() {
  const { user } = await requireAgencyContext();

  // Aggregates run in the database — never by fetching merchants and counting
  // them in JS.
  const [merchantCount, clientCount, verifiedCount, pendingCount, merchants] = await Promise.all([
    rawDb.tenant.count(),
    rawDb.customerProfile.count(),
    rawDb.tenant.count({ where: { subscriptionStatus: "ACTIVE" } }),
    rawDb.tenant.count({ where: { subscriptionStatus: "TRIAL" } }),
    rawDb.tenant.findMany({
      orderBy: { name: "asc" },
      include: {
        branding: { select: { businessName: true, logoUrl: true } },
        _count: { select: { customerProfiles: true } },
      },
    }),
  ]);

  const firstName = user.name?.split(" ")[0] ?? "there";

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-8">Welcome back, {firstName}! 👋</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Here&apos;s what&apos;s happening with your agency today.</p>
        </div>
        <AddMerchantButton />
      </header>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Merchants" value={merchantCount} icon={<Building2 className="h-4 w-4" />} tone="purple" />
        <StatCard label="Active Clients" value={clientCount} icon={<Users className="h-4 w-4" />} tone="indigo" />
        <StatCard label="Verified" value={verifiedCount} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <StatCard label="Pending" value={pendingCount} icon={<Clock className="h-4 w-4" />} tone="amber" />
      </div>

      <div className="mt-4">
        <MerchantList
          merchants={merchants.map((m) => ({
            id: m.id,
            name: m.branding?.businessName ?? m.name,
            logoUrl: m.branding?.logoUrl ?? null,
            clientCount: m._count.customerProfiles,
            isActive: m.status === "ACTIVE",
            verified: m.subscriptionStatus === "ACTIVE",
            createdAt: m.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
