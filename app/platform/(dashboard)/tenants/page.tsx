import Link from "next/link";
import { requirePlatformContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { Plus } from "lucide-react";

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformContext();
  const { q } = await searchParams;

  const tenants = await rawDb.tenant.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
      : undefined,
    include: { branding: true, _count: { select: { customerProfiles: true, staffProfiles: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <Link href="/platform/tenants/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New tenant
          </Button>
        </Link>
      </div>

      <form className="max-w-sm">
        <Input name="q" defaultValue={q} placeholder="Search by name or slug…" />
      </form>

      {tenants.length === 0 ? (
        <EmptyState title="No tenants found" description="Create your first tenant to get started." />
      ) : (
        <div className="space-y-2">
          {tenants.map((t) => (
            <Link key={t.id} href={`/platform/tenants/${t.id}`}>
              <Card className="transition-shadow hover:shadow-raised">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{t.branding?.businessName ?? t.name}</p>
                    <p className="text-xs text-ink-subtle">
                      /{t.slug} · {t._count.customerProfiles} customers · {t._count.staffProfiles} staff · created {formatDate(t.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge tone={t.status === "ACTIVE" ? "success" : "danger"}>{t.status}</Badge>
                    <Badge tone="neutral">{t.subscriptionStatus}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
