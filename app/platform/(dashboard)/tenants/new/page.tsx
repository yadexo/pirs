import { requirePlatformContext } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NewTenantForm } from "./new-tenant-form";

export default async function NewTenantPage() {
  await requirePlatformContext();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-lg font-semibold">New tenant</h1>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Clinic details</CardTitle>
          <CardDescription>Creates the workspace and its first clinic administrator account.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewTenantForm />
        </CardContent>
      </Card>
    </div>
  );
}
