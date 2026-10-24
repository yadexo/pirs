"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { unifiedSignInAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function LoginForm({ next }: { next?: string | null }) {
  const [state, formAction, pending] = useActionState(unifiedSignInAction, undefined);
  // Controlled, not read back from the DOM on the second step — React resets
  // a form's uncontrolled fields once its action settles (the same thing a
  // plain HTML form does after a non-JS post), which can beat an effect that
  // tries to read them via FormData afterwards, so the code step never saw
  // a value and silently never appeared. Holding them in state here sidesteps
  // that race entirely. The server only ever says "needsTwoFactor"; it never
  // hands the password back.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const needsCode = !!state && "needsTwoFactor" in state && state.needsTwoFactor;
  const errorMessage = state && "error" in state ? state.error : undefined;

  useEffect(() => {
    if (needsCode && !credentials && email && password) setCredentials({ email, password });
  }, [needsCode, credentials, email, password]);

  if (needsCode && credentials) {
    return (
      <form action={formAction} className="space-y-3.5">
        <input type="hidden" name="email" value={credentials.email} />
        <input type="hidden" name="password" value={credentials.password} />
        {next && <input type="hidden" name="next" value={next} />}
        <p className="text-[13px] text-ink-muted">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
        <div>
          <label htmlFor="totpCode" className="mb-1.5 block text-[12px] font-medium">
            Code
          </label>
          <input
            id="totpCode"
            name="totpCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456"
            className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        {errorMessage && <p className="text-[12px] text-[var(--accent-red)]">{errorMessage}</p>}
        <Button type="submit" loading={pending} className="w-full">
          Verify
        </Button>
        <button
          type="button"
          onClick={() => setCredentials(null)}
          className="block w-full text-center text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Use a different account
        </button>
      </form>
    );
  }

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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      {errorMessage && <p className="text-[12px] text-[var(--accent-red)]">{errorMessage}</p>}
      <Button type="submit" loading={pending} className="w-full">
        Sign in
      </Button>
      <Link href="/forgot-password" className="block text-center text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink">
        Forgot password?
      </Link>
    </form>
  );
}
