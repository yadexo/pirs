"use client";

import { useActionState } from "react";
import { unifiedSignInAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function LoginForm({ next }: { next?: string | null }) {
  const [state, formAction, pending] = useActionState(unifiedSignInAction, undefined);

  return (
    <form action={formAction} className="space-y-3.5">
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-[12px] font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-[12px] font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      {state?.error && <p className="text-[12px] text-[var(--accent-red)]">{state.error}</p>}
      <Button type="submit" loading={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
