import { notFound } from "next/navigation";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { updateServiceAction } from "@/lib/actions/catalog";
import { ServiceForm } from "../../service-form";

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();
  const { id } = await params;

  const [service, categories] = await Promise.all([
    db.service.findFirst({ where: { id } }),
    db.serviceCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!service) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Edit service</h1>
      <ServiceForm categories={categories} service={service} action={updateServiceAction.bind(null, id)} />
    </div>
  );
}
