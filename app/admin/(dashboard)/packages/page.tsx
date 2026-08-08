import Link from "next/link";
import { requireStaffContext } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Plus, Boxes } from "lucide-react";
import { ArchivePackageButton } from "./client";

export default async function AdminPackagesPage() {
  const { db } = await requireStaffContext();

  const packages = await db.package.findMany({
    where: { active: true },
    include: { items: { include: { service: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Packages</h1>
          <p className="text-sm text-ink-muted">Bundle services into prepaid packages.</p>
        </div>
        <Link href="/admin/packages/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New package
          </Button>
        </Link>
      </div>

      {packages.length === 0 ? (
        <EmptyState icon={<Boxes className="h-6 w-6" />} title="No packages yet" description="Bundle services together at a discount." />
      ) : (
        <div className="space-y-2">
          {packages.map((pkg) => (
            <Card key={pkg.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{pkg.name}</p>
                  <p className="text-xs text-ink-subtle">
                    {pkg.totalUses} uses · {formatMoney(pkg.priceCents)} · {pkg.items.map((i) => i.service.name).join(", ")}
                  </p>
                </div>
                <ArchivePackageButton id={pkg.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
