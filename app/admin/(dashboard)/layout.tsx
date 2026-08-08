import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { AdminSidebar } from "@/components/admin/sidebar";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user;
  if (!user || (user.role !== "TENANT_ADMIN" && user.role !== "STAFF") || !user.tenantId) {
    redirect("/admin/login");
  }

  const tenant = await rawDb.tenant.findUnique({ where: { id: user.tenantId }, include: { branding: true } });
  if (!tenant) redirect("/admin/login");

  const tenantName = tenant.branding?.businessName ?? tenant.name;

  return (
    <div className="flex min-h-screen">
      <AdminSidebar user={user} tenantName={tenantName} />
      <div className="flex-1 overflow-x-hidden">
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
