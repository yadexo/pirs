"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Copy, Globe, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toaster";
import { attachClinicDomainAction, checkClinicDomainAction, removeClinicDomainAction, type DomainView } from "@/lib/actions/clinic-domains";

const field = "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * One clinic's own domain: attach it, see the DNS records it needs, check
 * whether they have landed, remove it again.
 *
 * Nothing here decides anything — every button calls an action that checks
 * the admin's role, two-factor and impersonation state for itself, and the
 * refusal comes back as the message shown.
 */
export function DomainPanel({
  merchantId,
  slug,
  domain,
  configured,
}: {
  merchantId: string;
  slug: string;
  domain: DomainView | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string>();

  async function run(work: () => Promise<{ error?: string } | { ok: true }>, done: string): Promise<void> {
    setPending(true);
    setError(undefined);
    const result = await work();
    setPending(false);
    if ("error" in result && result.error) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success(done);
    router.refresh();
  }

  if (!configured) {
    return (
      <Panel>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Custom domains are not set up on this deployment. <code className="font-mono text-[12px]">VERCEL_API_TOKEN</code> and{" "}
          <code className="font-mono text-[12px]">VERCEL_PROJECT_ID</code> have to be set before a clinic can be given its own address.
        </p>
      </Panel>
    );
  }

  if (!domain) {
    return (
      <Panel>
        <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
          Give this clinic an address of its own, such as <span className="font-medium text-ink">app.clinicname.nl</span>. Its clients then
          reach the app there instead of at <span className="font-mono text-[12px]">/{slug}</span> — which keeps working either way.
        </p>
        <form
          action={async (fd) => { await run(() => attachClinicDomainAction(merchantId, fd), "Domain added. Now add the DNS records below."); }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="host" className="mb-1.5 block text-[12px] font-medium">
              Domain
            </label>
            <input id="host" name="host" required placeholder="app.clinicname.nl" autoComplete="off" spellCheck={false} className={field} />
          </div>
          <Button type="submit" loading={pending}>
            Add domain
          </Button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          A subdomain, never the domain itself — an apex cannot point here, and the clinic almost certainly wants its website to stay where it is.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[12px] text-[var(--accent-red)]">
            {error}
          </p>
        )}
      </Panel>
    );
  }

  const verified = domain.status === "VERIFIED";
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-ink-faint" />
          <span className="truncate text-[14px] font-semibold">{domain.host}</span>
          {verified ? (
            <Pill tone="green">
              <Check className="h-3 w-3" /> Verified
            </Pill>
          ) : domain.status === "FAILED" ? (
            <Pill tone="red">
              <TriangleAlert className="h-3 w-3" /> Failed
            </Pill>
          ) : (
            <Pill tone="amber">
              <Clock className="h-3 w-3" /> Waiting for DNS
            </Pill>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => checkClinicDomainAction(merchantId), "Checked.")}>
            Check now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={() => {
              if (!confirm(`Remove ${domain.host}? Its clients go back to using the shared address.`)) return;
              void run(() => removeClinicDomainAction(merchantId), "Domain removed.");
            }}
          >
            Remove
          </Button>
        </div>
      </div>

      {verified ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          This clinic&apos;s app is served at <span className="font-medium text-ink">https://{domain.host}</span>. The shared address still works,
          so anyone who has already installed the app keeps it.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
            Ask the clinic to add {domain.records.length === 1 ? "this record" : "these records"} wherever their DNS is managed. It usually takes
            minutes, sometimes longer, and nothing breaks in the meantime.
          </p>
          <ul className="mt-3 space-y-2">
            {domain.records.map((record) => (
              <li key={`${record.type}-${record.name}`} className="rounded-[10px] border border-border bg-app p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px]">
                  <span className="font-semibold">{record.type}</span>
                  <span>
                    <span className="text-ink-muted">name </span>
                    {record.name}
                  </span>
                  <span className="min-w-0 break-all">
                    <span className="text-ink-muted">value </span>
                    {record.value}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(record.value);
                      toast.success("Copied.");
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-1.5 py-0.5 text-ink-faint hover:bg-surface hover:text-ink"
                    aria-label={`Copy the ${record.type} value`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-muted">{record.why}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {domain.lastError && (
        <p role="alert" className="mt-3 rounded-[10px] bg-[var(--accent-red)]/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
          {domain.lastError}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[12px] text-[var(--accent-red)]">
          {error}
        </p>
      )}
      <p className="mt-3 text-[11px] text-ink-muted">
        {domain.lastCheckedAt ? `Last checked ${new Date(domain.lastCheckedAt).toLocaleString()}` : "Not checked yet"}
      </p>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Custom domain</h2>
      {children}
    </section>
  );
}
