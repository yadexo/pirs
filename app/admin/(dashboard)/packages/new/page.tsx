import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { createPackageAction } from "@/lib/actions/catalog";
import { PackageForm } from "../package-form";

export default async function NewPackagePage() {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();
  const services = await db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New package</h1>
      <PackageForm services={services} action={createPackageAction} />
    </div>
  );
}
