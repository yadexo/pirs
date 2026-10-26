"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("portal.appBuilder.notifyOffer");
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
    toast.success(t("cancelled"));
    router.refresh();
  }

  if (!canSend) {
    return (
      <FormSection title={t("title")}>
        <input type="hidden" name="notifyMode" value="none" />
        <p className="text-[12px] text-ink-muted">{t("needsSendPermission")}</p>
        {sent && <p className="text-[12px] text-ink-muted">{t("notifiedOn", { when: when(sent.sentAt) })}</p>}
      </FormSection>
    );
  }

  return (
    <FormSection title={t("title")}>
      {(sent || scheduled) && (
        <div className="flex items-center gap-2 rounded-[10px] bg-app px-3 py-2 text-[12px]">
          {sent && (
            <span>
              {t("sentOnTo", { when: when(sent.sentAt), count: sent.devicesReached })}
            </span>
          )}
          {scheduled && (
            <>
              <Pill tone="amber">{t("scheduledPill")}</Pill>
              <span>{t("goesOut", { when: when(scheduled.scheduledAt) })}</span>
              <Button type="button" size="sm" variant="outline" onClick={cancelScheduled}>
                {t("cancelIt")}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {(
          [
            ["none", t("dontNotify")],
            ["now", startsLater ? t("notifyWhenStarts") : t("notifyNow")],
            ["schedule", t("schedule")],
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
              label={t("when")}
              name="notifyAt"
              type="datetime-local"
              min={startsLater ? localInput(start) : undefined}
              defaultValue={localInput(startsLater ? start : new Date(Date.now() + 60 * 60 * 1000))}
              errors={errors}
              hint={startsLater ? t("notBeforeStart", { when: when(startAt) }) : t("outsideSendingHours")}
            />
          )}

          <TextField
            label={t("notificationTitle")}
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
            label={t("message")}
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
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-faint">{t("preview")}</p>
            <div className="rounded-[12px] bg-surface p-3 shadow-card">
              <p className="text-[13px] font-semibold">{title || clinicName}</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">{body || t("messagePlaceholder")}</p>
            </div>
          </div>

          <p className="text-[12px] text-ink-muted">
            {audience === null ? t("countingClients") : audience === 0 ? t("nobodyWillGetThis") : t("audienceCount", { count: audience })}{" "}
            {t("sendingHoursNote")}
          </p>

          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" name="notifyIgnoreDailyLimit" className="h-3.5 w-3.5" />
            {t("alsoSendToAlreadyNotified")}
          </label>

          {sent && (
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" name="notifyAgain" checked={again} onChange={(e) => setAgain(e.target.checked)} className="h-3.5 w-3.5" />
              {t("alreadyGotOne", { when: when(sent.sentAt) })}
            </label>
          )}
        </>
      )}
    </FormSection>
  );
}
