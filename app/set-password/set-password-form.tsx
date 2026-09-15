"use client";

import { useActionState } from "react";
import { setPasswordAction } from "@/lib/actions/password";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/merchant/form";

export function SetPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, action, pending] = useActionState(setPasswordAction, undefined);
  return (
    <form action={action} className="space-y-3.5">
      <input type="hidden" name="token" value={token} />
      <TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={minLength} required />
      <TextField label="Repeat it" name="confirm" type="password" autoComplete="new-password" minLength={minLength} required />
      {state?.error && (
        <p role="alert" className="text-[12px] text-[var(--accent-red)]">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        Save password
      </Button>
    </form>
  );
}
