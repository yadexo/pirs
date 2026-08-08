import { requireStaffContext, requireRole } from "@/lib/rbac";
import { EmptyState } from "@/components/ui/empty-state";
import { ShieldCheck } from "lucide-react";
import { NewRoleForm } from "./client";
import { RoleCard } from "./role-card";

export default async function AdminRolesPage() {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const roles = await db.role.findMany({
    include: { permissions: { include: { permission: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Staff roles</h1>
        <NewRoleForm />
      </div>

      {roles.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No roles yet" description="Create a role to control what staff can access." />
      ) : (
        <div className="space-y-4">
          {roles.map((role) => (
            <RoleCard key={role.id} role={role} />
          ))}
        </div>
      )}
    </div>
  );
}
