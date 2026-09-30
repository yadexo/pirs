"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { FormSection, SelectField, TextAreaField, TextField, type FieldErrors } from "@/components/merchant/form";
import { cancelCampaignAction, saveCampaignAction } from "@/lib/actions/campaigns";
import { describeActionFailure } from "@/lib/action-failure";

/**
 * Messages to this clinic's clients: now, or at a time the clinic picks.
 *
 * The rules that protect clients are enforced on the server, but they are
 * written on the form too — a clinic that knows a message will be held until
 * morning is not surprised when it is.
 */

export interface CampaignRow {
  id: string;
  name: string;
  body: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  devicesReached: number;
  /** Why anyone was left out — shown under the row. */
  outcomeNote: string | null;
  clientName: string | null;
}

const STATUS_TONE: Record<string, "green" | "amber" | "neutral" | "red"> = {
  SENT: "green",
  SCHEDULED: "amber",
  SENDING: "amber",
  CANCELLED: "neutral",
  DRAFT: "neutral",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function BroadcastForm({
  merchantId,
  devices,
  products,
  campaigns,
}: {
  merchantId: string;
  devices: number;
  products: { id: string; name: string }[];
  campaigns: CampaignRow[];
}) {
  const router = useRouter();
  const [sending, setSending] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [later, setLater] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setErrors({});

    const fd = new FormData(e.currentTarget);
    const result = await saveCampaignAction(merchantId, {
      title: String(fd.get("title") ?? ""),
      body: String(fd.get("body") ?? ""),
      productId: String(fd.get("productId") ?? "") || undefined,
      scheduledAt: later ? String(fd.get("scheduledAt") ?? "") || undefined : undefined,
    }).catch((err) => ({ error: describeActionFailure(err) }) as const);
    setSending(false);

    if ("error" in result) {
      setErrors("fieldErrors" in result ? (result.fieldErrors ?? {}) : {});
      toast.error(result.error);
      return;
    }

    if (result.scheduledFor) {
      toast.success(
        result.heldUntil
          ? `Scheduled for ${when(result.heldUntil)} — your sending hours had closed.`
          : `Scheduled for ${when(result.scheduledFor)}.`,
      );
    } else {
      toast.success(result.devices === 1 ? "Sent to 1 device" : `Sent to ${result.devices} devices`);
    }
    formRef.current?.reset();
    setLater(false);
    router.refresh();
  }

  async function cancel(id: string) {
    const result = await cancelCampaignAction(merchantId, id).catch((err) => ({ error: describeActionFailure(err) }) as const);
    if ("error" in result) return toast.error(result.error);
    toast.success("Cancelled");
    router.refresh();
  }

  return (
    <>
      <form ref={formRef} onSubmit={submit}>
        <FormSection title="Send a notification">
          <p className="text-[12px] text-ink-muted">
            {devices === 0
              ? "None of your clients have turned notifications on yet. They can, from the app's Home screen or Profile → Settings."
              : `${devices} ${devices === 1 ? "device has" : "devices have"} notifications on. Only clients who left "offers and news" on are sent these.`}
          </p>
          <TextField label="Title" name="title" maxLength={60} placeholder="Winter sale" errors={errors} required />
          <TextAreaField
            label="Message"
            name="body"
            rows={3}
            maxLength={200}
            placeholder="Everything in the shop is 20% off until Sunday."
            errors={errors}
            required
          />
          {products.length > 0 && (
            <SelectField
              label="Open a product (optional)"
              name="productId"
              errors={errors}
              options={[{ value: "", label: "Just open the shop" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}

          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} className="h-4 w-4" />
            Send later
          </label>
          {later && (
            <TextField
              label="When"
              name="scheduledAt"
              type="datetime-local"
              errors={errors}
              hint="Outside your sending hours it waits until they next open."
              required
            />
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={sending || devices === 0}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sending ? "Working…" : later ? "Schedule" : "Send now"}
            </Button>
          </div>
          <p className="text-[12px] text-ink-muted">
            Up to 5 an hour, each client gets at most one a day from you, and nothing goes out outside your sending hours.
          </p>
        </FormSection>
      </form>

      {campaigns.length > 0 && (
        <FormSection title="Scheduled and sent">
          <ul className="divide-y divide-border rounded-card border border-border">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{c.name}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {c.status === "SENT"
                      ? `Sent ${when(c.sentAt)} · ${c.devicesReached} ${c.devicesReached === 1 ? "device" : "devices"}`
                      : c.status === "SCHEDULED"
                        ? `Goes out ${when(c.scheduledAt)}`
                        : c.status.toLowerCase()}
                    {c.clientName ? ` · ${c.clientName} only` : ""}
                  </p>
                  {c.outcomeNote && <p className="mt-0.5 text-[11px] text-ink-muted">{c.outcomeNote}</p>}
                </div>
                <Pill tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status.toLowerCase()}</Pill>
                {c.status === "SCHEDULED" && (
                  <Button size="sm" variant="outline" onClick={() => void cancel(c.id)}>
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </FormSection>
      )}
    </>
  );
}
