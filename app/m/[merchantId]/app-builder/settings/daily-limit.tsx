"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SelectField, type FieldErrors } from "@/components/merchant/form";

/**
 * How often one client may hear from this clinic in a day.
 *
 * The warning on the loose settings isn't a scolding — a client who finds the
 * app noisy turns notifications off entirely, and that is not a decision they
 * come back and reverse.
 */
const DAILY_LIMIT_VALUES = ["1", "2", "3", "5", "0"] as const;
// Value → messages/*.json portal.appBuilder.settings.dailyLimit.choices key.
const DAILY_LIMIT_CHOICE_KEYS: Record<(typeof DAILY_LIMIT_VALUES)[number], string> = {
  "1": "oneADay",
  "2": "twoADay",
  "3": "threeADay",
  "5": "fiveADay",
  "0": "noLimit",
};

export function DailyLimitField({ defaultValue, errors }: { defaultValue: number; errors: FieldErrors }) {
  const t = useTranslations("portal.appBuilder.settings.dailyLimit");
  const tChoices = useTranslations("portal.appBuilder.settings.dailyLimit.choices");
  const [value, setValue] = React.useState(String(defaultValue));
  const loose = value === "5" || value === "0";
  const choices = DAILY_LIMIT_VALUES.map((v) => ({ value: v, label: tChoices(DAILY_LIMIT_CHOICE_KEYS[v]) }));

  return (
    <>
      <SelectField
        label={t("maxPerClientPerDay")}
        name="marketingDailyLimit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        options={choices}
        errors={errors}
      />
      {loose && <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">{t("looseWarning")}</p>}
      <p className="text-[12px] text-ink-muted">{t("exemptionsNote")}</p>
    </>
  );
}
