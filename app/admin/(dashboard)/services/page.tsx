import Link from "next/link";
import { requireStaffContext } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { Plus, Layers } from "lucide-react";
import { ArchiveServiceButton, NewCategoryForm, EditCategoryButton } from "./client";

export default async function AdminServicesPage() {
  const { db } = await requireStaffContext();

  const categories = await db.serviceCategory.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: { services: { orderBy: { sortOrder: "asc" } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Services</h1>
          <p className="text-sm text-ink-muted">Manage your service catalogue and categories.</p>
        </div>
        <div className="flex gap-2">
          <NewCategoryForm />
          <Link href="/admin/services/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> New service
            </Button>
          </Link>
        </div>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-6 w-6" />}
          title="No service categories yet"
          description="Create a category, then add services to it."
        />
      ) : (
        <div className="space-y-6">
          {categories.map((category) => (
            <div key={category.id}>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
                {category.name}
                <EditCategoryButton category={category} />
              </h2>
              {category.services.length === 0 ? (
                <p className="text-sm text-ink-subtle">No services in this category yet.</p>
              ) : (
                <div className="space-y-2">
                  {category.services.map((service) => (
                    <Card key={service.id}>
                      <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                        <div>
                          <Link href={`/admin/services/${service.id}/edit`} className="font-medium hover:underline">
                            {service.name}
                          </Link>
                          <p className="text-xs text-ink-subtle">
                            {service.durationMinutes} min · {formatMoney(service.priceCents)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {!service.active && <Badge tone="neutral">Archived</Badge>}
                          <ArchiveServiceButton id={service.id} disabled={!service.active} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
