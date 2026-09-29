"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { FormSection, TextAreaField, TextField, type FieldErrors } from "@/components/merchant/form";
import { cancelCampaignAction } from "@/lib/actions/campaigns";
import { offerAudienceCountAction } from "@/lib/actions/app-builder";
import { describeActionFailure } from "@/lib/action-failure";

/**
 * Telling clients about an offer, from the form where the offer is written.
 *
 * The rules that decide who actually gets it live on the server; this shows
 * them, because a clinic that expects 40 notifications and sees 6 should
 * understand why before it asks.
 */

export interface OfferCampaign {
  id: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  devicesReached: number;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** The datetime-local value for an instant, in the browser's own timezone. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NotifyOffer({
  merchantId,
  offerTitle,
  offerDescription,
  startAt,
  clinicName,
  campaigns,
  canSend,
  errors,
}: {
  merchantId: string;
  offerTitle: string;
  offerDescription: string;
  /** The offer's start, as an ISO string — drives the wording and the earliest time. */
  startAt: string;
  clinicName: string;
  campaigns: OfferCampaign[];
  /** False when this staff member may write offers but not send messages. */
  canSend: boolean;
  errors: FieldErrors;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"none" | "now" | "schedule">("none");
  const [title, setTitle] = React.useState(offerTitle);
  const [body, setBody] = React.useState(offerDescription);
  const [audience, setAudience] = React.useState<number | null>(null);
  const [again, setAgain] = React.useState(false);

  const start = new Date(startAt);
  const startsLater = start.getTime() > Date.now();
  const sent = campaigns.find((c) => c.status === "SENT") ?? null;
  const scheduled = campaigns.find((c) => c.status === "SCHEDULED") ?? null;

  // The title and message follow the offer until the clinic edits them.
  const touched = React.useRef(false);
  React.useEffect(() => {
    if (touched.current) return;
    setTitle(offerTitle);
    setBody(offerDescription);
  }, [offerTitle, offerDescription]);

  React.useEffect(() => {
    if (mode === "none" || audience !== null || !canSend) return;
    void offerAudienceCountAction(merchantId)
      .then((res) => setAudience("error" in res ? 0 : res.clients))
      .catch(() => setAudience(0));
  }, [mode, audience, merchantId, canSend]);

  async function cancelScheduled() {
    if (!scheduled) return;
    const res = await cancelCampaignAction(merchantId, scheduled.id).catch((err) => ({ error: describeActionFailure(err) }) as const);
    if ("error" in res) return toast.error(res.error);
    toast.success("Notification cancelled");
    router.refresh();
  }

  if (!canSend) {
    return (
      <FormSection title="Notify clients">
        <input type="hidden" name="notifyMode" value="none" />
        <p className="text-[12px] text-ink-muted">
          You can write offers, but sending notifications needs the &ldquo;Send messages&rdquo; permission. Ask an owner to send it, or to give you that
          permission.
        </p>
        {sent && <p className="text-[12px] text-ink-muted">Clients were notified on {when(sent.sentAt)}.</p>}
      </FormSection>
    );
  }

  return (
    <FormSection title="Notify clients">
      {(sent || scheduled) && (
        <div className="flex items-center gap-2 rounded-[10px] bg-app px-3 py-2 text-[12px]">
          {sent && (
            <span>
              Sent on {when(sent.sentAt)} to {sent.devicesReached} {sent.devicesReached === 1 ? "device" : "devices"}.
            </span>
          )}
          {scheduled && (
            <>
              <Pill tone="amber">scheduled</Pill>
              <span>Goes out {when(scheduled.scheduledAt)}.</span>
              <Button type="button" size="sm" variant="outline" onClick={cancelScheduled}>
                Cancel it
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {(
          [
            ["none", "Don't notify"],
            ["now", startsLater ? "Notify when the offer starts" : "Notify now"],
            ["schedule", "Schedule"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-[13px]">
            <input type="radio" name="notifyMode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-3.5 w-3.5" />
            {label}
          </label>
        ))}
      </div>

      {mode !== "none" && (
        <>
          {mode === "schedule" && (
            <TextField
              label="When"
              name="notifyAt"
              type="datetime-local"
              min={startsLater ? localInput(start) : undefined}
              defaultValue={localInput(startsLater ? start : new Date(Date.now() + 60 * 60 * 1000))}
              errors={errors}
              hint={startsLater ? `Not before the offer starts, ${when(startAt)}.` : "Anything between 21:00 and 09:00 is held until 09:00."}
            />
          )}

          <TextField
            label="Notification title"
            name="notifyTitle"
            value={title}
            onChange={(e) => {
              touched.current = true;
              setTitle(e.target.value);
            }}
            maxLength={60}
            errors={errors}
          />
          <TextAreaField
            label="Message"
            name="notifyBody"
            rows={2}
            value={body}
            onChange={(e) => {
              touched.current = true;
              setBody(e.target.value);
            }}
            maxLength={200}
            errors={errors}
          />

          {/* Roughly what lands on a phone: clinic name, then the message. */}
          <div className="rounded-card border border-border bg-app p-3">
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-faint">Preview</p>
            <div className="rounded-[12px] bg-surface p-3 shadow-card">
              <p className="text-[13px] font-semibold">{title || clinicName}</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">{body || "Your message will appear here."}</p>
            </div>
          </div>

          <p className="text-[12px] text-ink-muted">
            {audience === null
              ? "Counting clients…"
              : audience === 0
                ? "Nobody will get this yet: it goes only to clients with notifications on who left “offers and news” switched on."
                : `${audience} ${audience === 1 ? "client has" : "clients have"} notifications and offers switched on.`}{" "}
            Nothing is sent between 21:00 and 09:00, and each client hears from you at most once a day.
          </p>

          {sent && (
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" name="notifyAgain" checked={again} onChange={(e) => setAgain(e.target.checked)} className="h-3.5 w-3.5" />
              Clients already got one for this offer on {when(sent.sentAt)} — send it again.
            </label>
          )}
        </>
      )}
    </FormSection>
  );
}
