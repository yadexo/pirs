import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { createServiceAction } from "@/lib/actions/catalog";
import { ServiceForm } from "../service-form";

export default async function NewServicePage() {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();
  const categories = await db.serviceCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New service</h1>
      <ServiceForm categories={categories} action={createServiceAction} />
    </div>
  );
}
