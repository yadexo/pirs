import Link from "next/link";

export default function RootPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Clinic Engagement Platform</h1>
      <p className="max-w-md text-ink-muted">
        This is the platform root. Customers use their clinic&apos;s own branded link, staff
        sign in to the admin dashboard, and platform administrators manage tenants.
      </p>
      <div className="flex gap-3">
        <Link href="/admin/login" className="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-brand-primary-foreground">
          Staff sign in
        </Link>
        <Link href="/platform/login" className="rounded-md border border-border px-4 py-2 text-sm font-medium">
          Platform admin
        </Link>
      </div>
    </main>
  );
}
