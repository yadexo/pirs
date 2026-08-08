import { notFound } from "next/navigation";
import { requireStaffContext, requireRole } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { ActiveToggle } from "../client";
import { RoleAssignment, ServicesAssignment, LocationsAssignment, AvailabilityManager } from "./client";

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  const { id } = await params;

  const [staff, roles, services, locations] = await Promise.all([
    db.staffProfile.findFirst({
      where: { id },
      include: {
        user: true,
        role: true,
        services: true,
        locations: true,
        availability: { orderBy: { dayOfWeek: "asc" } },
      },
    }),
    db.role.findMany({ orderBy: { name: "asc" } }),
    db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!staff) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {staff.firstName} {staff.lastName}
          </h1>
          <p className="text-sm text-ink-subtle">{staff.user.email}</p>
        </div>
        <ActiveToggle staffProfileId={staff.id} active={staff.active} />
      </div>

      {staff.user.role !== "TENANT_ADMIN" && (
        <Card>
          <CardHeader>
            <CardTitle>Role</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="role">Assigned role</Label>
            <RoleAssignment staffProfileId={staff.id} roles={roles} currentRoleId={staff.roleId} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Assigned services</CardTitle>
        </CardHeader>
        <CardContent>
          <ServicesAssignment staffProfileId={staff.id} services={services} assignedIds={staff.services.map((s) => s.serviceId)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned locations</CardTitle>
        </CardHeader>
        <CardContent>
          <LocationsAssignment staffProfileId={staff.id} locations={locations} assignedIds={staff.locations.map((l) => l.locationId)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Working hours</CardTitle>
        </CardHeader>
        <CardContent>
          <AvailabilityManager staffProfileId={staff.id} availability={staff.availability} />
        </CardContent>
      </Card>
    </div>
  );
}
