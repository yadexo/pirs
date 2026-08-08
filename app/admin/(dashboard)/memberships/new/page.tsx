import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { MembershipPlanForm } from "../plan-form";

export default async function NewMembershipPlanPage() {
  await requirePermission("memberships.manage");
  const { db } = await requireStaffContext();
  const services = await db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New membership plan</h1>
      <MembershipPlanForm services={services} />
    </div>
  );
}
