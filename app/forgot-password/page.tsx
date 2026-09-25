import Link from "next/link";
import { currentClientBasePath } from "@/lib/public-clinic";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const { clinic } = await searchParams;
  // Only a well-formed slug is carried into the form.
  const slug = clinic && /^[a-z0-9-]{1,80}$/.test(clinic) ? clinic : null;
  // The clinic app's address on this host, so a client installed on the root
  // domain comes back inside their app rather than beside it.
  const backToApp = slug ? await currentClientBasePath(slug) : "/login";
  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-card">
        <h1 className="text-[18px] font-semibold">Reset your password</h1>
        <p className="mt-1 text-[13px] text-ink-muted">We&apos;ll email you a link to choose a new one.</p>
        <div className="mt-5">
          <ForgotPasswordForm clinic={slug} />
        </div>
        <Link
          href={backToApp}
          className="mt-4 block text-center text-[12.5px] text-ink-muted underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
