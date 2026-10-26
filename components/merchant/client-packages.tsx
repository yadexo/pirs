"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { describeActionFailure } from "@/lib/action-failure";
import { formatDay } from "@/lib/client-format";
import { clientPackagesAction, spendPackageSessionAction, type StaffPackageView } from "@/lib/actions/redeem";

/**
 * A client's session packages at the desk.
 *
 * A package has no code to scan — it is a count, not a ticket — so staff
 * reach it through the client. Using one asks which of the covered treatments
 * it is for, because a package covering three of them is three different
 * appointments and the history should say which.
 *
 * Spent and expired packages stay on the list with their reason. "Where did
 * my sessions go" is a question the desk has to be able to answer.
 */
export function ClientPackages({
  merchantId,
  customerProfileId,
  onUsed,
}: {
  merchantId: string;
  customerProfileId: string;
  /** Lets a parent refresh whatever else it is showing about this client. */
  onUsed?: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("merchant.clientPackages");
  const tc = useTranslations("common");
  const [packages, setPackages] = React.useState<StaffPackageView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [using, setUsing] = React.useState<StaffPackageView | null>(null);
  const [serviceId, setServiceId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    const res = await clientPackagesAction(merchantId, customerProfileId).catch((err) => ({ error: describeActionFailure(err) }));
    if ("error" in res) {
      setError(res.error);
      setPackages([]);
      return;
    }
    setPackages(res.packages);
  }, [merchantId, customerProfileId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function start(pkg: StaffPackageView) {
    setUsing(pkg);
    // One covered treatment needs no choosing.
    setServiceId(pkg.covers.length === 1 ? pkg.covers[0]!.id : "");
    setNote("");
  }

  async function confirm() {
    if (!using || !serviceId) return;
    setPending(true);
    const res = await spendPackageSessionAction(merchantId, { customerPackageId: using.id, serviceId, note: note || undefined }).catch((err) => ({
      error: describeActionFailure(err),
    }));
    setPending(false);
    if ("error" in res) {
      toast.error(res.error);
      // The count may have moved under us; show what it really is now.
      await load();
      return;
    }
    toast.success(t("sessionUsed", { remaining: res.remainingUses }));
    setUsing(null);
    await load();
    onUsed?.();
    router.refresh();
  }

  if (packages === null) {
    return (
      <div className="flex h-20 items-center justify-center text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (error) return <p className="rounded-[10px] bg-[var(--danger-tint)] px-3 py-2 text-[13px] text-[var(--danger)]">{error}</p>;
  if (packages.length === 0) return null;

  if (using) {
    const after = using.remainingUses - 1;
    return (
      <div className="space-y-3">
        <div className="rounded-card bg-app p-4">
          <p className="text-[15px] font-semibold">{using.name}</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {t("sessionsLeftOf", { remaining: using.remainingUses, total: using.totalUses })}
            {using.expiresAt ? ` · ${t("validUntil", { date: formatDay(using.expiresAt) })}` : ""}
          </p>
        </div>

        <label className="block text-[14px] font-semibold text-ink">
          {t("whichTreatment")}
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="mt-1 h-12 w-full rounded-[14px] bg-surface px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink)]"
          >
            <option value="">{t("chooseATreatment")}</option>
            {using.covers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[14px] font-semibold text-ink">
          {t("noteOptional")}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            maxLength={200}
            className="mt-1 h-12 w-full rounded-[14px] bg-surface px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink)]"
          />
        </label>

        <p className="pk-notice pk-notice-info">
          <span className="txt">{t("sessionsLeftAfter", { count: after })}</span>
        </p>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" type="button" onClick={() => setUsing(null)} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button className="flex-1" type="button" onClick={() => void confirm()} disabled={pending || !serviceId}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("useOneSession")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[14px] font-semibold text-ink">{t("sessionPackages")}</p>
      <ul className="divide-y divide-border rounded-card bg-app">
        {packages.map((pkg) => (
          <li key={pkg.id} className="px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{pkg.name}</p>
                <p className="truncate text-[13px] text-ink-muted">
                  {t("sessionsLeftOf", { remaining: pkg.remainingUses, total: pkg.totalUses })}
                  {pkg.expiresAt
                    ? ` · ${pkg.expired ? t("expiredOn", { date: formatDay(pkg.expiresAt) }) : t("validUntil", { date: formatDay(pkg.expiresAt) })}`
                    : ""}
                </p>
              </div>
              {pkg.usable ? (
                <Button size="sm" onClick={() => start(pkg)}>
                  {t("useASession")}
                </Button>
              ) : (
                <Pill tone={pkg.expired ? "neutral" : "amber"}>{pkg.expired ? t("expired") : t("noneLeft")}</Pill>
              )}
            </div>

            {pkg.history.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {pkg.history.slice(0, 3).map((h) => (
                  <li key={h.id} className="text-[13px] text-ink-faint">
                    {h.serviceName} · {formatDay(h.usedAt)}
                    {h.staffName ? ` · ${h.staffName}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
