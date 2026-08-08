"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/lib/actions/profile";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import type { CustomerProfile } from "@prisma/client";

export function ProfileForm({ tenantSlug, profile }: { tenantSlug: string; profile: CustomerProfile }) {
  const action = updateProfileAction.bind(null, tenantSlug);
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" defaultValue={profile.firstName} required />
        </div>
        <div>
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" defaultValue={profile.lastName} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} />
        </div>
        <div>
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={profile.dateOfBirth?.toISOString().slice(0, 10)} />
        </div>
      </div>
      <div>
        <Label htmlFor="addressLine1">Address</Label>
        <Input id="addressLine1" name="addressLine1" defaultValue={profile.addressLine1 ?? ""} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" defaultValue={profile.city ?? ""} />
        </div>
        <div>
          <Label htmlFor="region">State</Label>
          <Input id="region" name="region" defaultValue={profile.region ?? ""} />
        </div>
        <div>
          <Label htmlFor="postalCode">ZIP</Label>
          <Input id="postalCode" name="postalCode" defaultValue={profile.postalCode ?? ""} />
        </div>
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">Save changes</SubmitButton>
    </form>
  );
}
