"use client";

import { useActionState } from "react";
import { customerRegisterAction } from "@/lib/actions/auth";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";

export function CustomerRegisterForm({ tenantSlug }: { tenantSlug: string }) {
  const action = customerRegisterAction.bind(null, tenantSlug);
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div>
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink-muted">
        <input type="checkbox" name="marketingConsent" className="mt-0.5" />
        Send me promotions and updates by email.
      </label>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
