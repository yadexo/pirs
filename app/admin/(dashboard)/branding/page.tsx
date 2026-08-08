import { requireStaffContext, requireRole } from "@/lib/rbac";
import { BrandingForm } from "./branding-form";

export default async function AdminBrandingPage() {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  const branding = await db.tenantBranding.findFirst({ where: {} });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Branding</h1>
      <BrandingForm branding={branding} />
    </div>
  );
}
