import Link from "next/link";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Users } from "lucide-react";
import { NewTagForm } from "./client";

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("customers.view");
  const { db } = await requireStaffContext();
  const { q } = await searchParams;

  const customers = await db.customerProfile.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : undefined,
    include: { user: true, tags: { include: { tag: true } }, memberships: { where: { status: "ACTIVE" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Customers</h1>
        <NewTagForm />
      </div>

      <form className="max-w-sm">
        <Input name="q" defaultValue={q} placeholder="Search by name or email…" />
      </form>

      {customers.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="No customers found" />
      ) : (
        <div className="space-y-2">
          {customers.map((c) => (
            <Link key={c.id} href={`/admin/customers/${c.id}`}>
              <Card className="transition-shadow hover:shadow-raised">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-xs text-ink-subtle">{c.user.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.memberships.length > 0 && <Badge tone="brand">Member</Badge>}
                    {c.tags.map((t) => (
                      <Badge key={t.tagId} tone="neutral">
                        {t.tag.name}
                      </Badge>
                    ))}
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
