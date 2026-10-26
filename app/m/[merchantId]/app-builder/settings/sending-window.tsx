"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SelectField, type FieldErrors } from "@/components/merchant/form";
import { DAY_MINUTES, DEFAULT_WINDOW_END, DEFAULT_WINDOW_START, includesNight, windowChoices } from "@/lib/marketing-window";

/**
 * The hours a clinic may send marketing in.
 *
 * The platform used to pick these — 07:00 to 22:00, an hour wide at least.
 * It doesn't any more: a clinic can send round the clock if it decides that
 * is right for its clients. What is left is a warning, because a notification
 * at two in the morning is how an app gets its notifications switched off,
 * and that is not a decision clients come back and reverse.
 */
export function SendingWindowFields({
  startMinutes,
  endMinutes,
  errors,
}: {
  startMinutes: number;
  endMinutes: number;
  errors: FieldErrors;
}) {
  const t = useTranslations("portal.appBuilder.settings.sendingWindow");
  const [start, setStart] = React.useState(startMinutes ?? DEFAULT_WINDOW_START);
  const [end, setEnd] = React.useState(endMinutes ?? DEFAULT_WINDOW_END);
  const [allDay, setAllDay] = React.useState(startMinutes === 0 && endMinutes >= DAY_MINUTES);

  // 24/7 is stored as the whole day, so it needs no column of its own.
  const effectiveStart = allDay ? 0 : start;
  const effectiveEnd = allDay ? DAY_MINUTES : end;
  const night = includesNight(effectiveStart, effectiveEnd);

  return (
    <>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4" />
        {t("sendAnyTime")}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label={t("from")}
          name="marketingWindowStartMinutes"
          value={String(effectiveStart)}
          onChange={(e) => setStart(Number(e.target.value))}
          disabled={allDay}
          options={windowChoices("start").map((c) => ({ value: String(c.value), label: c.label }))}
          errors={errors}
        />
        <SelectField
          label={t("until")}
          name="marketingWindowEndMinutes"
          value={String(effectiveEnd)}
          onChange={(e) => setEnd(Number(e.target.value))}
          disabled={allDay}
          options={windowChoices("end").map((c) => ({ value: String(c.value), label: c.label }))}
          errors={errors}
        />
      </div>

      {night && <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">{t("nightWarning")}</p>}

      <p className="text-[12px] text-ink-muted">{t("quarterHourNote")}</p>
    </>
  );
}
