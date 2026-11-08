"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { unifiedSignInAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

/**
 * `portal` is the door the page was opened at (lib/portal-scope.ts). It rides
 * along on the form because it only narrows which accounts the sign-in looks
 * at — it grants nothing — and the page sets it from the host. `clinic` is set
 * for a client door only, so "forgot password" resets that clinic's client
 * account rather than a staff account on the same address.
 */
export function LoginForm({ next, portal = "staff", clinic = null }: { next?: string | null; portal?: string; clinic?: string | null }) {
  const t = useTranslations("auth");
  const forgotHref = clinic ? `/forgot-password?clinic=${encodeURIComponent(clinic)}` : `/forgot-password?portal=${encodeURIComponent(portal)}`;
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
        <input type="hidden" name="portal" value={portal} />
        {next && <input type="hidden" name="next" value={next} />}
        <p className="text-[13px] text-ink-muted">{t("twoFactor.prompt")}</p>
        <div>
          <label htmlFor="totpCode" className="mb-1.5 block text-[12px] font-medium">
            {t("twoFactor.codeLabel")}
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
          {t("twoFactor.verify")}
        </Button>
        <button
          type="button"
          onClick={() => setCredentials(null)}
          className="block w-full text-center text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {t("twoFactor.useDifferentAccount")}
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-3.5">
      <input type="hidden" name="portal" value={portal} />
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-[12px] font-medium">
          {t("email")}
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
          {t("password")}
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
        {t("signIn")}
      </Button>
      <Link href={forgotHref} className="block text-center text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink">
        {t("forgotPassword")}
      </Link>
    </form>
  );
}
