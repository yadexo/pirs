import Link from "next/link";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { signOutAction } from "@/lib/actions/session";

const ROLE_LABEL: Record<string, string> = {
  PLATFORM_ADMIN: "Platform admin",
  TENANT_ADMIN: "Clinic admin",
  STAFF: "Clinic staff",
  CUSTOMER: "Client",
};

/** Which of the three cards this role can actually open. */
function surfaceForRole(role: string): "Admin" | "Clinic" | "Client" | null {
  if (role === "PLATFORM_ADMIN") return "Admin";
  if (role === "TENANT_ADMIN" || role === "STAFF") return "Clinic";
  if (role === "CUSTOMER") return "Client";
  return null;
}

/**
 * Entry point to the three surfaces this platform ships: the agency console,
 * a merchant's clinic portal, and the patient app. It exists so the whole
 * system can be walked through without knowing the routes by heart, and it
 * reads its merchants from the database rather than a hardcoded list.
 */
export const dynamic = "force-dynamic";

interface Surface {
  key: string;
  name: string;
  tagline: string;
  audience: string;
  accent: string;
  href: string;
  /** Rendered under the card so the demo can be driven without a password hunt. */
  account: { email: string; label: string } | null;
  routes: string[];
  merchants?: { id: string; slug: string; name: string; href: string }[];
}

export default async function PortalIndexPage() {
  const session = await auth();
  const mySurface = session?.user ? surfaceForRole(session.user.role) : null;

  const [agency, tenants] = await Promise.all([
    rawDb.agencySettings.findFirst(),
    rawDb.tenant.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, slug: true, name: true, branding: { select: { businessName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const merchants = tenants.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.branding?.businessName ?? t.name,
  }));
  const first = merchants[0];

  // Demo logins, resolved from the database so this page can't drift from the
  // seed. Passwords are deliberately not shown — see the note at the foot.
  const [platformAdmin, tenantAdmin, customer] = await Promise.all([
    rawDb.user.findFirst({ where: { role: "PLATFORM_ADMIN" }, select: { email: true } }),
    rawDb.user.findFirst({ where: { role: "TENANT_ADMIN", tenantId: first?.id }, select: { email: true } }),
    rawDb.user.findFirst({ where: { role: "CUSTOMER", tenantId: first?.id }, select: { email: true } }),
  ]);

  const surfaces: Surface[] = [
    {
      key: "admin",
      name: "Admin",
      tagline: "The agency console",
      audience: "Whoever runs the platform",
      accent: "var(--accent-purple)",
      href: `/login?next=${encodeURIComponent("/agency")}`,
      account: platformAdmin ? { email: platformAdmin.email, label: "Platform admin" } : null,
      routes: ["Overview", "White label", "Settings"],
    },
    {
      key: "clinic",
      name: "Clinic",
      tagline: "The merchant portal",
      audience: "Clinic owners and their staff",
      accent: "var(--primary)",
      href: first ? `/login?next=${encodeURIComponent(`/m/${first.id}`)}` : "/login",
      account: tenantAdmin ? { email: tenantAdmin.email, label: "Clinic admin" } : null,
      routes: ["Home", "Appointments", "Client Profiles", "Shop Summary", "Memberships", "App Builder"],
      merchants: merchants.map((m) => ({ ...m, href: `/login?next=${encodeURIComponent(`/m/${m.id}`)}` })),
    },
    {
      key: "client",
      name: "Client",
      tagline: "The patient app",
      audience: "The clinic's own clients",
      accent: "var(--accent-pink)",
      href: first ? `/login?next=${encodeURIComponent(`/app/${first.slug}`)}` : "/login",
      account: customer ? { email: customer.email, label: "Client" } : null,
      routes: ["Home", "Shop", "Scan", "Rewards", "Profile"],
      merchants: merchants.map((m) => ({ ...m, href: `/login?next=${encodeURIComponent(`/app/${m.slug}`)}` })),
    },
  ];

  return (
    <main className="min-h-screen bg-app px-5 py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10">
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">
              {(agency?.name ?? "D").charAt(0)}
            </span>
            <span className="text-[15px] font-semibold">{agency?.name ?? "DezaAI"}</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Three portals, one system</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-muted">
            Every surface below reads and writes the same database. A booking made in the patient app appears on the clinic&apos;s
            Appointments screen; a purchase lands in its Shop Summary. Pick a portal to open it.
          </p>

          {session?.user && (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-surface px-4 py-3 shadow-card">
              <span className="text-[13px] text-ink-muted">
                Signed in as <span className="font-medium text-ink">{session.user.email}</span>
                <span className="text-ink-faint"> — {ROLE_LABEL[session.user.role] ?? session.user.role}</span>
              </span>
              <span className="text-[13px] text-ink-faint">
                <span className="font-medium text-ink">{mySurface}</span> opens directly. Pick another and you can switch
                account from there.
              </span>
              <div className="flex-1" />
              <form action={signOutAction}>
                <button type="submit" className="text-[13px] font-medium underline underline-offset-2">
                  Sign out to switch
                </button>
              </form>
            </div>
          )}
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {surfaces.map((s) => (
            <section
              key={s.key}
              className="flex flex-col rounded-card border border-border bg-surface p-5 shadow-card"
              style={{ borderTopColor: s.accent, borderTopWidth: 3 }}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-[17px] font-semibold">{s.name}</h2>
                {mySurface === s.name ? (
                  <span
                    className="rounded-pill px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white"
                    style={{ background: s.accent }}
                  >
                    Your session
                  </span>
                ) : (
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">{s.key}</span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] font-medium" style={{ color: s.accent }}>
                {s.tagline}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{s.audience}</p>

              <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                {s.routes.map((r) => (
                  <li key={r} className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                    <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: s.accent }} />
                    {r}
                  </li>
                ))}
              </ul>

              <div className="flex-1" />

              {s.merchants && s.merchants.length > 1 ? (
                <div className="mt-5 space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Choose a merchant</p>
                  {s.merchants.map((m) => (
                    <Link
                      key={m.id}
                      href={m.href}
                      className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-app"
                    >
                      {m.name}
                      <span aria-hidden className="text-ink-faint">
                        &rsaquo;
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <Link
                  href={s.href}
                  className="mt-5 flex h-10 items-center justify-center rounded-[10px] text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: s.accent }}
                >
                  Open {s.name}
                </Link>
              )}

              {s.account && (
                <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                  {mySurface && mySurface !== s.name ? (
                    <>
                      Needs <span className="font-medium text-ink">{s.account.email}</span>
                      <span className="text-ink-faint"> — {s.account.label}</span>
                    </>
                  ) : (
                    <>
                      Sign in as <span className="font-medium text-ink">{s.account.email}</span>
                      <span className="text-ink-faint"> — {s.account.label}</span>
                    </>
                  )}
                </p>
              )}
            </section>
          ))}
        </div>

        <footer className="mt-8 rounded-card border border-border bg-surface p-4 text-[12.5px] leading-relaxed text-ink-muted shadow-card">
          <p>
            Each card opens the same{" "}
            <Link href="/login" className="font-medium text-ink underline underline-offset-2">
              sign-in screen
            </Link>
            , carrying the portal you picked, and lands you inside it. Sign in with an account that has no business there — a
            clinic admin choosing Admin, say — and you go to your own portal instead, which is the tenant isolation doing its
            job. Every account here is locally seeded demo data sharing one password.
          </p>
        </footer>
      </div>
    </main>
  );
}
