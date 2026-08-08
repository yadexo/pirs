"use client";

import { useActionState } from "react";
import { Input, Label, Textarea, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import type { Service } from "@prisma/client";

export function PackageForm({
  services,
  action,
}: {
  services: Service[];
  action: (prevState: unknown, formData: FormData) => Promise<{ error?: string } | undefined>;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="price">Price (USD)</Label>
          <Input id="price" name="price" type="number" step="0.01" min="0" required />
        </div>
        <div>
          <Label htmlFor="totalUses">Total uses</Label>
          <Input id="totalUses" name="totalUses" type="number" min="1" required />
        </div>
        <div>
          <Label htmlFor="expiryDays">Expires after (days)</Label>
          <Input id="expiryDays" name="expiryDays" type="number" min="1" placeholder="Optional" />
        </div>
      </div>
      <div>
        <Label>Included services</Label>
        <FieldHint>Select every service a customer can redeem with this package.</FieldHint>
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-subtle">
              <input type="checkbox" name="serviceIds" value={s.id} />
              {s.name}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="transferable" />
        Transferable between customers
      </label>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">Create package</SubmitButton>
    </form>
  );
}
