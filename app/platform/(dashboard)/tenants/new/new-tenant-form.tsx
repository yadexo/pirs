"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createTenantAction } from "@/lib/actions/platform";
import { Input, Label, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { Card, CardContent } from "@/components/ui/card";

export function NewTenantForm() {
  const [state, formAction] = useActionState(createTenantAction, undefined);

  if (state && "success" in state && state.success) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-medium text-success">Tenant created</p>
          <p className="text-sm text-ink-muted">
            Share these one-time credentials with the clinic administrator. The password is only shown once.
          </p>
          <div className="rounded-md bg-surface-subtle p-3 text-sm">
            <p>Workspace: <span className="font-mono">{state.slug}</span></p>
            <p>Email: <span className="font-mono">{state.adminEmail}</span></p>
            <p>Temporary password: <span className="font-mono">{state.tempPassword}</span></p>
          </div>
          <Link href={`/platform/tenants`} className="inline-block text-sm text-brand-primary hover:underline">
            Back to tenants
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="clinicName">Clinic / practice name</Label>
        <Input id="clinicName" name="clinicName" required />
      </div>
      <div>
        <Label htmlFor="slug">Workspace slug (optional)</Label>
        <Input id="slug" name="slug" placeholder="auto-generated from name" />
        <FieldHint>Used in URLs, e.g. yourapp.com/riverside-clinic</FieldHint>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="adminFirstName">Admin first name</Label>
          <Input id="adminFirstName" name="adminFirstName" required />
        </div>
        <div>
          <Label htmlFor="adminLastName">Admin last name</Label>
          <Input id="adminLastName" name="adminLastName" required />
        </div>
      </div>
      <div>
        <Label htmlFor="adminEmail">Admin email</Label>
        <Input id="adminEmail" name="adminEmail" type="email" required />
      </div>
      {state && "error" in state && <FieldError>{state.error}</FieldError>}
      <SubmitButton>Create tenant</SubmitButton>
    </form>
  );
}
