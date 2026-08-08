import Link from "next/link";
import { requireStaffContext, requireRole } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { UserCog } from "lucide-react";
import { InviteStaffForm } from "./client";

export default async function AdminStaffPage() {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const [staff, roles] = await Promise.all([
    db.staffProfile.findMany({ include: { user: true, role: true }, orderBy: { firstName: "asc" } }),
    db.role.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Staff</h1>
          <p className="text-sm text-ink-muted">
            Manage staff access. <Link href="/admin/staff/roles" className="text-brand-primary hover:underline">Manage roles</Link>
          </p>
        </div>
        <InviteStaffForm roles={roles} />
      </div>

      {staff.length === 0 ? (
        <EmptyState icon={<UserCog className="h-6 w-6" />} title="No staff yet" />
      ) : (
        <div className="space-y-2">
          {staff.map((s) => (
            <Link key={s.id} href={`/admin/staff/${s.id}`}>
              <Card className="transition-shadow hover:shadow-raised">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">
                      {s.firstName} {s.lastName}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {s.user.email} · {s.user.role === "TENANT_ADMIN" ? "Administrator" : s.role?.name ?? "No role"}
                    </p>
                  </div>
                  <Badge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Inactive"}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
