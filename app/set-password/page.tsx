import Link from "next/link";
import { inspectPasswordToken, MIN_PASSWORD_LENGTH } from "@/lib/password-tokens";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

/** One page for both accepting a staff invitation and resetting a password. */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const info = await inspectPasswordToken(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-card">
        {info ? (
          <>
            <h1 className="text-[18px] font-semibold">{info.isInvite ? "Set up your account" : "Choose a new password"}</h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              For <span className="font-medium text-ink">{info.email}</span>. At least {MIN_PASSWORD_LENGTH} characters.
            </p>
            <div className="mt-5">
              <SetPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[18px] font-semibold">This link no longer works</h1>
            <p className="mt-1 text-[13px] text-ink-muted">Links work once and expire. Ask for a new one.</p>
            <Link href="/forgot-password" className="mt-5 block text-[13px] font-medium text-primary underline underline-offset-2">
              Send a new link
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
