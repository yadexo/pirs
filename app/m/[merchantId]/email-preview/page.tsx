import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { Panel } from "@/components/ui/primitives";
import { isRealProduction } from "@/lib/deploy-env";
import { buildPreviewTemplates } from "@/lib/emails/preview-data";
import { cn } from "@/lib/utils";

/**
 * Every transactional email, rendered with made-up data in this clinic's own
 * branding — so a clinic admin can see what their clients actually receive
 * before any of it goes out for real.
 *
 * Staff-only (requireMerchantContext) and staging/local-only: a 404 on the
 * real production domains, same gate as the demo portal index — see
 * lib/deploy-env.ts.
 */
export default async function EmailPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ type?: string; format?: string }>;
}) {
  if (isRealProduction()) notFound();

  const { merchantId } = await params;
  const ctx = await requireMerchantContext(merchantId);
  const { type, format } = await searchParams;

  const branding = await ctx.db.tenantBranding.findFirst({ where: {}, select: { logoUrl: true } });
  const templates = buildPreviewTemplates({ name: ctx.merchantName, logoUrl: branding?.logoUrl ?? null, color: ctx.accentColor }, ctx.merchantSlug);
  const keys = Object.keys(templates);
  const currentKey = type && templates[type] ? type : keys[0]!;
  const entry = templates[currentKey]!;
  const asText = format === "text";

  return (
    <div className="flex flex-col gap-6">
      <MerchantPageHeader title="Email preview" description="Staff-only, staging-only. What clients actually receive, in this clinic's own branding." />
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <Panel className="h-fit p-2">
          <nav className="flex flex-col gap-1">
            {keys.map((k) => (
              <Link
                key={k}
                href={`?type=${k}${asText ? "&format=text" : ""}`}
                className={cn(
                  "rounded-[8px] px-3 py-2 text-[13px] font-medium",
                  k === currentKey ? "bg-[var(--ink)] text-white" : "text-ink hover:bg-app",
                )}
              >
                {templates[k]!.label}
              </Link>
            ))}
          </nav>
        </Panel>

        <Panel className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-faint">Subject</p>
              <p className="text-[14px] font-semibold">{entry.template.subject}</p>
            </div>
            <div className="flex gap-1 rounded-[8px] bg-app p-1">
              <Link href={`?type=${currentKey}`} className={cn("rounded-[6px] px-3 py-1.5 text-[12px] font-medium", !asText ? "bg-surface shadow-card" : "text-ink-muted")}>
                HTML
              </Link>
              <Link href={`?type=${currentKey}&format=text`} className={cn("rounded-[6px] px-3 py-1.5 text-[12px] font-medium", asText ? "bg-surface shadow-card" : "text-ink-muted")}>
                Plain text
              </Link>
            </div>
          </div>

          {asText ? (
            <pre className="whitespace-pre-wrap rounded-[10px] bg-app p-4 text-[13px] leading-relaxed text-ink">{entry.template.text}</pre>
          ) : (
            // The one legitimate use for an iframe here: a full HTML document
            // (its own <head>, inline styles meant for a mail client) has to
            // render in isolation from the portal's own page, not inline.
            <iframe title={entry.label} srcDoc={entry.template.html} className="h-[720px] w-full rounded-[10px] border border-border bg-white" />
          )}
        </Panel>
      </div>
    </div>
  );
}
