"use client";

import { useActionState } from "react";
import { platformSignInAction } from "@/lib/actions/auth";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";

export function PlatformLoginForm() {
  const [state, formAction] = useActionState(platformSignInAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
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
