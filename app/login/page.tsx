import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { LoginForm } from "./login-form";

/**
 * The one login screen. Where a user lands afterwards is decided by their
 * role, not by which URL they arrived from — agency admins go to /agency,
 * merchant users go to their own sub-account Home.
 */
/** Where a signed-in user belongs, decided by role rather than by URL. */
function landingFor(role: string, tenantId: string | null): string {
  if (role === "PLATFORM_ADMIN") return "/agency";
  if (tenantId) return `/m/${tenantId}`;
  return "/login";
}

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect(landingFor(session.user.role, session.user.tenantId));

  const agency = await rawDb.agencySettings.findFirst();

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">
            {(agency?.name ?? "D").charAt(0)}
          </span>
          <span className="text-[15px] font-semibold">{agency?.name ?? "DezaAI"}</span>
        </div>
        <div className="rounded-card border border-border bg-surface p-6 shadow-card">
          <h1 className="text-[18px] font-semibold">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Enter your credentials to continue.</p>
          <div className="mt-5">
            <LoginForm />
          </div>
        </div>
      </div>
    </main>
  );
}
