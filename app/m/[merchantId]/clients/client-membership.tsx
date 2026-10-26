"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@/lib/utils";
import {
  cancelClientMembershipAction,
  clientMembershipAction,
  giveFreePeriodsAction,
  pauseClientMembershipAction,
  resumeClientMembershipAction,
  switchClientPlanAction,
  type ClientMembershipView,
  type PlanOption,
} from "@/lib/actions/client-membership";

/**
 * One client's membership, and everything a clinic can do to it.
 *
 * Each control asks for a reason before it does anything, because each one
 * changes what the client pays or what they get, and the client is told in
 * those words. The history underneath is the record of every such decision.
 */

type Action = "cancel" | "pause" | "resume" | "switch" | "free";

const STATUS_TONE: Record<string, "green" | "neutral" | "amber" | "red"> = {
  ACTIVE: "green",
  TRIAL: "green",
  PENDING: "amber",
  PAST_DUE: "amber",
  SUSPENDED: "red",
  PAUSED: "neutral",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

export function ClientMembershipPanel({
  merchantId,
  customerProfileId,
  canManage,
}: {
  merchantId: string;
  customerProfileId: string;
  /** memberships.manage — without it this is a read-only record. */
  canManage: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("portal.clients.clientMembership");
  const tc = useTranslations("common");
  const locale = useLocale();
  const WHEN = React.useCallback(
    (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"),
    [locale],
  );
  const TITLE: Record<Action, string> = {
    cancel: t("titleCancel"),
    pause: t("titlePause"),
    resume: t("titleResume"),
    switch: t("titleSwitch"),
    free: t("titleFree"),
  };
  const CONFIRM: Record<Action, string> = {
    cancel: t("confirmCancel"),
    pause: t("confirmPause"),
    resume: t("confirmResume"),
    switch: t("confirmSwitch"),
    free: t("confirmFree"),
  };
  const DONE: Record<Action, string> = {
    cancel: t("doneCancel"),
    pause: t("donePause"),
    resume: t("doneResume"),
    switch: t("doneSwitch"),
    free: t("doneFree"),
  };
  const [membership, setMembership] = React.useState<ClientMembershipView | null>(null);
  const [plans, setPlans] = React.useState<PlanOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [action, setAction] = React.useState<Action | null>(null);
  const [reason, setReason] = React.useState("");
  const [when, setWhen] = React.useState<"now" | "period_end">("period_end");
  const [planId, setPlanId] = React.useState("");
  const [periods, setPeriods] = React.useState("1");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await clientMembershipAction(merchantId, customerProfileId);
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMembership(res.membership);
    setPlans(res.plans);
  }, [merchantId, customerProfileId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function open(next: Action) {
    setAction(next);
    setReason("");
    setError(null);
    setWhen("period_end");
    setPeriods("1");
    setPlanId(plans.find((p) => p.id !== membership?.planId)?.id ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !membership || busy) return;
    setBusy(true);
    setError(null);

    const res =
      action === "cancel"
        ? await cancelClientMembershipAction(merchantId, membership.id, { when, reason })
        : action === "pause"
          ? await pauseClientMembershipAction(merchantId, membership.id, { reason })
          : action === "resume"
            ? await resumeClientMembershipAction(merchantId, membership.id, { reason })
            : action === "switch"
              ? await switchClientPlanAction(merchantId, membership.id, { planId, reason })
              : await giveFreePeriodsAction(merchantId, membership.id, { periods, reason });

    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast.success(DONE[action]);
    setAction(null);
    await load();
    router.refresh();
  }

  if (loading && !membership) {
    return (
      <p className="flex items-center gap-2 py-8 text-[12px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("loadingMembership")}
      </p>
    );
  }
  if (!membership) {
    return <p className="py-8 text-center text-[12px] text-ink-muted">{error ?? t("notAMember")}</p>;
  }

  const money = (cents: number) => formatMoney(cents, membership.currency);
  const per = membership.frequency === "MONTHLY" ? t("perMonth") : t("perYear");

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-[12px] border border-border bg-app px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold">{membership.planName}</span>
          <Pill tone={STATUS_TONE[membership.status] ?? "neutral"}>{membershipStatusLabel(membership.status, t)}</Pill>
        </div>
        <p className="tabular text-[13px] text-ink-muted">{t("priceEach", { price: money(membership.priceCents), per })}</p>
        <dl className="space-y-1 text-[12px]">
          <Row label={t("currentPeriod")} value={`${WHEN(membership.currentPeriodStart)} – ${WHEN(membership.currentPeriodEnd)}`} />
          <Row label={t("nextPayment")} value={membership.cancelAtPeriodEnd ? t("endsAtPeriodEnd") : WHEN(membership.nextBillingAt)} />
          {!membership.givesBenefits && <Row label={t("benefits")} value={t("notActiveNow")} />}
          {membership.pastDueSince && <Row label={t("pastDueSince")} value={WHEN(membership.pastDueSince)} />}
        </dl>
      </div>

      {canManage && !action && membership.status !== "CANCELLED" && (
        <div className="flex flex-wrap gap-2">
          {membership.status === "PAUSED" ? (
            <Button type="button" size="sm" variant="outline" onClick={() => open("resume")}>
              {t("resumeBilling")}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => open("pause")}>
              {t("pauseBilling")}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => open("switch")} disabled={plans.length < 2}>
            {t("titleSwitch")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => open("free")}>
            {t("titleFree")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => open("cancel")}>
            {tc("cancel")}
          </Button>
        </div>
      )}

      {canManage && action && (
        <form onSubmit={submit} className="space-y-3 rounded-[12px] border border-border p-4">
          <p className="text-[13px] font-semibold">{TITLE[action]}</p>

          {action === "cancel" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={when === "period_end"} onChange={() => setWhen("period_end")} />
                {t("atEndOfPeriod", { date: WHEN(membership.currentPeriodEnd) })}
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} />
                {t("immediately")}
              </label>
              {/* Said out loud, because one of these takes away something the
                  client has already paid for. */}
              <p className="text-[11px] text-ink-faint">{when === "now" ? t("cancelNowWarning") : t("cancelAtEndWarning")}</p>
            </div>
          )}

          {action === "switch" && (
            <label className="block space-y-1">
              <span className="text-[12px] text-ink-muted">{t("newPlan")}</span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="h-9 w-full rounded-[10px] border border-border bg-surface px-2 text-[13px] outline-none"
              >
                {plans
                  .filter((p) => p.id !== membership.planId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {t("priceEach", { price: `${p.name} — ${money(p.priceCents)}`, per: p.frequency === "MONTHLY" ? t("perMonth") : t("perYear") })}
                    </option>
                  ))}
              </select>
              <span className="block text-[11px] text-ink-faint">{t("takesEffectOn", { date: WHEN(membership.currentPeriodEnd) })}</span>
            </label>
          )}

          {action === "free" && (
            <label className="block space-y-1">
              <span className="text-[12px] text-ink-muted">{membership.frequency === "MONTHLY" ? t("howManyMonthsFree") : t("howManyYearsFree")}</span>
              <input
                value={periods}
                onChange={(e) => setPeriods(e.target.value)}
                inputMode="numeric"
                className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <span className="block text-[11px] text-ink-faint">{t("benefitsContinue")}</span>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-[12px] text-ink-muted">{t("reason")}</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              autoFocus={action !== "switch"}
              className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <p className="text-[11px] text-ink-faint">{t("clientIsTold")}</p>

          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={action === "cancel" ? "danger" : "primary"} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {CONFIRM[action]}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)} disabled={busy}>
              {t("keepAsIs")}
            </Button>
          </div>
        </form>
      )}

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">{t("billingHistory")}</p>
        {membership.history.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-ink-muted">{t("nothingYet")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {membership.history.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[12px]">{row.description ?? row.type}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {new Date(row.at).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                {row.amountCents !== null && row.amountCents > 0 && <span className="tabular shrink-0 text-[12px] font-medium">{money(row.amountCents)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function membershipStatusLabel(status: string, t: ReturnType<typeof useTranslations>): string {
  switch (status) {
    case "ACTIVE":
      return t("statusActive");
    case "TRIAL":
      return t("statusTrial");
    case "PENDING":
      return t("statusPending");
    case "PAST_DUE":
      return t("statusPastDue");
    case "SUSPENDED":
      return t("statusSuspended");
    case "PAUSED":
      return t("statusPaused");
    case "CANCELLED":
      return t("statusCancelled");
    case "EXPIRED":
      return t("statusExpired");
    default:
      return status.replace("_", " ").toLowerCase();
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
