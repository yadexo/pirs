"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { toast } from "sonner";
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

const WHEN = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—");

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
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the membership…
      </p>
    );
  }
  if (!membership) {
    return <p className="py-8 text-center text-[12px] text-ink-muted">{error ?? "This client isn't a member."}</p>;
  }

  const money = (cents: number) => formatMoney(cents, membership.currency);
  const per = membership.frequency === "MONTHLY" ? "month" : "year";

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-[12px] border border-border bg-app px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold">{membership.planName}</span>
          <Pill tone={STATUS_TONE[membership.status] ?? "neutral"}>{membership.status.replace("_", " ").toLowerCase()}</Pill>
        </div>
        <p className="tabular text-[13px] text-ink-muted">
          {money(membership.priceCents)} per {per}
        </p>
        <dl className="space-y-1 text-[12px]">
          <Row label="Current period" value={`${WHEN(membership.currentPeriodStart)} – ${WHEN(membership.currentPeriodEnd)}`} />
          <Row label="Next payment" value={membership.cancelAtPeriodEnd ? "None — ends at the period's end" : WHEN(membership.nextBillingAt)} />
          {!membership.givesBenefits && <Row label="Benefits" value="Not active right now" />}
          {membership.pastDueSince && <Row label="Past due since" value={WHEN(membership.pastDueSince)} />}
        </dl>
      </div>

      {canManage && !action && membership.status !== "CANCELLED" && (
        <div className="flex flex-wrap gap-2">
          {membership.status === "PAUSED" ? (
            <Button type="button" size="sm" variant="outline" onClick={() => open("resume")}>
              Resume billing
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => open("pause")}>
              Pause billing
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => open("switch")} disabled={plans.length < 2}>
            Switch plan
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => open("free")}>
            Give free time
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => open("cancel")}>
            Cancel
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
                At the end of this period ({WHEN(membership.currentPeriodEnd)})
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} />
                Immediately
              </label>
              {/* Said out loud, because one of these takes away something the
                  client has already paid for. */}
              <p className="text-[11px] text-ink-faint">
                {when === "now"
                  ? "They lose the rest of the period they've paid for. Nothing is refunded automatically."
                  : "They keep what they've paid for, and nothing more is charged."}
              </p>
            </div>
          )}

          {action === "switch" && (
            <label className="block space-y-1">
              <span className="text-[12px] text-ink-muted">New plan</span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="h-9 w-full rounded-[10px] border border-border bg-surface px-2 text-[13px] outline-none"
              >
                {plans
                  .filter((p) => p.id !== membership.planId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {money(p.priceCents)} per {p.frequency === "MONTHLY" ? "month" : "year"}
                    </option>
                  ))}
              </select>
              <span className="block text-[11px] text-ink-faint">
                Takes effect on {WHEN(membership.currentPeriodEnd)}. Nothing is charged or refunded before then.
              </span>
            </label>
          )}

          {action === "free" && (
            <label className="block space-y-1">
              <span className="text-[12px] text-ink-muted">How many {per}s free</span>
              <input
                value={periods}
                onChange={(e) => setPeriods(e.target.value)}
                inputMode="numeric"
                className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <span className="block text-[11px] text-ink-faint">Benefits continue; the next payment moves back.</span>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-[12px] text-ink-muted">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this is happening"
              autoFocus={action !== "switch"}
              className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <p className="text-[11px] text-ink-faint">The client is told, with this reason in your words.</p>

          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={action === "cancel" ? "danger" : "primary"} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {CONFIRM[action]}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)} disabled={busy}>
              Keep as it is
            </Button>
          </div>
        </form>
      )}

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">Billing history</p>
        {membership.history.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-ink-muted">Nothing on this membership yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {membership.history.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[12px]">{row.description ?? row.type}</span>
                  <span className="block text-[11px] text-ink-faint">{new Date(row.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
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

const TITLE: Record<Action, string> = {
  cancel: "Cancel this membership",
  pause: "Pause billing",
  resume: "Resume billing",
  switch: "Switch plan",
  free: "Give free time",
};

const CONFIRM: Record<Action, string> = {
  cancel: "Cancel membership",
  pause: "Pause",
  resume: "Resume",
  switch: "Switch",
  free: "Give",
};

const DONE: Record<Action, string> = {
  cancel: "Membership cancelled",
  pause: "Billing paused",
  resume: "Billing resumed",
  switch: "Plan changed from the next period",
  free: "Free time given",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
