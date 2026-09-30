"use client";

import * as React from "react";
import { SelectField, type FieldErrors } from "@/components/merchant/form";

/**
 * How often one client may hear from this clinic in a day.
 *
 * The warning on the loose settings isn't a scolding — a client who finds the
 * app noisy turns notifications off entirely, and that is not a decision they
 * come back and reverse.
 */
export const DAILY_LIMIT_CHOICES = [
  { value: "1", label: "1 a day (recommended)" },
  { value: "2", label: "2 a day" },
  { value: "3", label: "3 a day" },
  { value: "5", label: "5 a day" },
  { value: "0", label: "No limit" },
];

export function DailyLimitField({ defaultValue, errors }: { defaultValue: number; errors: FieldErrors }) {
  const [value, setValue] = React.useState(String(defaultValue));
  const loose = value === "5" || value === "0";

  return (
    <>
      <SelectField
        label="Maximum marketing notifications per client per day"
        name="marketingDailyLimit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        options={DAILY_LIMIT_CHOICES}
        errors={errors}
      />
      {loose && (
        <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">
          Clients who get too many notifications tend to switch them off altogether — and they rarely switch them back on.
        </p>
      )}
      <p className="text-[12px] text-ink-muted">
        Birthday messages and discounts meant for one client don&apos;t count towards this, and a single notification can be marked to reach
        everyone anyway.
      </p>
    </>
  );
}
