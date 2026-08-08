"use client";

import { useActionState } from "react";
import { updateRolePermissionsAction } from "@/lib/actions/staff";
import { PERMISSIONS } from "@/lib/permissions";
import { SubmitButton } from "@/components/auth/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RoleCard({ role }: { role: { id: string; name: string; permissions: { permission: { key: string } }[] } }) {
  const action = updateRolePermissionsAction.bind(null, role.id);
  const [, formAction] = useActionState(action, undefined);
  const activeKeys = new Set(role.permissions.map((p) => p.permission.key));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{role.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <div className="grid gap-1 sm:grid-cols-2">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="permissions" value={p.key} defaultChecked={activeKeys.has(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
          <SubmitButton className="w-auto">Save permissions</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
