"use client";

import { useActionState } from "react";
import { staffSignInAction } from "@/lib/actions/auth";
import { Input, Label, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";

export function StaffLoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(staffSignInAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <Label htmlFor="workspace">Workspace</Label>
        <Input id="workspace" name="workspace" placeholder="your-clinic-slug" required />
        <FieldHint>The URL slug your clinic was set up with.</FieldHint>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
