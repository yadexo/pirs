"use client";

import * as React from "react";
import { useActionState } from "react";
import { BlackButton } from "@/components/client-app/primitives";
import { customerSignInAction, customerRegisterAction } from "@/lib/actions/auth";

const field =
  "h-14 w-full rounded-[var(--radius-tile)] bg-[var(--pill-bg)] px-4 text-[16px] outline-none placeholder:text-[var(--faint)]";

/**
 * Logged-out state. The spec asks for phone/email OTP sign-in; this build
 * reuses the existing email+password customer auth (the same backend the
 * old customer app used) rather than standing up a real OTP/SMS verification
 * flow with no provider behind it. Swapping the form fields here for an OTP
 * step later doesn't change anything downstream — the session shape is the
 * same either way.
 */
export function Onboarding({ merchantSlug, merchantName, logoUrl }: { merchantSlug: string; merchantName: string; logoUrl: string | null }) {
  const [mode, setMode] = React.useState<"signin" | "register">("signin");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={merchantName} className="h-14 w-auto object-contain" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-tile)] bg-[var(--black)] text-[20px] font-bold text-white">
          {merchantName.charAt(0)}
        </span>
      )}
      <h1 className="mt-6 text-center text-[27px] font-bold leading-tight text-[var(--ink-strong)]">
        {mode === "signin" ? `Welcome back to ${merchantName}` : `Join ${merchantName}`}
      </h1>

      <div className="mt-8 w-full max-w-sm">
        {mode === "signin" ? <SignInForm merchantSlug={merchantSlug} /> : <RegisterForm merchantSlug={merchantSlug} />}
      </div>

      <button type="button" onClick={() => setMode(mode === "signin" ? "register" : "signin")} className="press mt-6 text-[15px] text-[var(--muted)]">
        {mode === "signin" ? (
          <>
            New here? <span className="font-semibold text-[var(--ink)]">Create an account</span>
          </>
        ) : (
          <>
            Already a member? <span className="font-semibold text-[var(--ink)]">Sign in</span>
          </>
        )}
      </button>
    </div>
  );
}

function SignInForm({ merchantSlug }: { merchantSlug: string }) {
  const action = customerSignInAction.bind(null, merchantSlug);
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <input name="email" type="email" placeholder="Email" autoComplete="email" required className={field} />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required className={field} />
      {state?.error && <p className="text-[13px] text-[var(--danger)]">{state.error}</p>}
      <BlackButton type="submit" loading={pending} className="w-full">
        Sign in
      </BlackButton>
      <a
        href={`/forgot-password?clinic=${encodeURIComponent(merchantSlug)}`}
        style={{ display: "block", textAlign: "center", fontSize: 14, color: "var(--muted)", textDecoration: "underline", paddingTop: 4 }}
      >
        Forgot password?
      </a>
    </form>
  );
}

function RegisterForm({ merchantSlug }: { merchantSlug: string }) {
  const action = customerRegisterAction.bind(null, merchantSlug);
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex gap-3">
        <input name="firstName" placeholder="First name" required className={field} />
        <input name="lastName" placeholder="Last name" required className={field} />
      </div>
      <input name="email" type="email" placeholder="Email" autoComplete="email" required className={field} />
      <input name="password" type="password" placeholder="Password" autoComplete="new-password" required minLength={8} className={field} />
      {state?.error && <p className="text-[13px] text-[var(--danger)]">{state.error}</p>}
      <BlackButton type="submit" loading={pending} className="w-full">
        Create account
      </BlackButton>
    </form>
  );
}
