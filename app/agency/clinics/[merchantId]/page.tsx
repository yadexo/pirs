import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAgencyContext } from "@/lib/merchant-context";
import { rawDb } from "@/lib/db";
import { dnsRecordsFor, type VercelVerificationChallenge } from "@/lib/clinic-domain";
import { vercelConfig } from "@/lib/vercel-domains";
import { DomainPanel } from "./domain-panel";
import type { DomainView } from "@/lib/actions/clinic-domains";

/**
 * The agency's own page for one clinic — as opposed to /m/<id>, which is the
 * clinic's portal seen through an admin's eyes. Things that belong to the
 * platform rather than to the clinic live here; the custom domain is the
 * first of them.
 */
export default async function AgencyClinicPage({ params }: { params: Promise<{ merchantId: string }> }) {
  // Platform admin, two-factor confirmed, or this redirects before anything
  // is read. Every action on the page checks again for itself.
  await requireAgencyContext();
  const { merchantId } = await params;

  const clinic = await rawDb.tenant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      branding: { select: { businessName: true } },
      domains: { where: { type: "CLIENT" } },
    },
  });
  if (!clinic) notFound();

  const row = clinic.domains[0];
  const domain: DomainView | null = row
    ? {
        host: row.host,
        status: row.status,
        records: dnsRecordsFor(row.host, Array.isArray(row.verification) ? (row.verification as unknown as VercelVerificationChallenge[]) : []),
        lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        lastError: row.lastError,
      }
    : null;

  const name = clinic.branding?.businessName ?? clinic.name;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <Link href="/agency" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted underline-offset-2 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> All clinics
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-[22px] font-semibold tracking-tight">{name}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {clinic.status === "ACTIVE" ? "Active" : clinic.status} · /{clinic.slug}
        </p>
      </header>

      <DomainPanel merchantId={clinic.id} slug={clinic.slug} domain={domain} configured={vercelConfig() !== null} />
    </main>
  );
}
