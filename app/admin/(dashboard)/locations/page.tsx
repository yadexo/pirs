import { requireStaffContext, requireRole } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MapPin } from "lucide-react";
import { NewLocationForm, ArchiveLocationButton } from "./client";

export default async function AdminLocationsPage() {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const locations = await db.location.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Locations</h1>
        <NewLocationForm />
      </div>

      {locations.length === 0 ? (
        <EmptyState icon={<MapPin className="h-6 w-6" />} title="No locations yet" description="Add a location so appointments can be booked." />
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <Card key={loc.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">
                    {loc.name} {loc.isPrimary && <Badge tone="brand">Primary</Badge>}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {[loc.addressLine1, loc.city, loc.region, loc.postalCode].filter(Boolean).join(", ") || "No address on file"}
                  </p>
                </div>
                {!loc.isPrimary && <ArchiveLocationButton id={loc.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
