"use client";

import { useTranslations } from "next-intl";
import { REGISTRATION_MIN_PASSWORD_LENGTH } from "@/lib/registration-constants";

const field = "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary";
const label = "mb-1.5 block text-[12px] font-medium";

/**
 * The password half of a register form, shown only while
 * REGISTRATION_SET_PASSWORD_DIRECTLY is on — both register pages render it
 * the same way, and the action ignores these fields entirely when the flag is
 * off, so a stale page cannot post its way into an active account.
 */
export function PasswordFields({ errors }: { errors: Record<string, string> }) {
  const t = useTranslations("register.password");
  return (
    <>
      <div>
        <label htmlFor="password" className={label}>
          {t("label")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={REGISTRATION_MIN_PASSWORD_LENGTH}
          maxLength={200}
          autoComplete="new-password"
          className={field}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{t("hint", { min: REGISTRATION_MIN_PASSWORD_LENGTH })}</p>
        {errors.password && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.password}</p>}
      </div>
      <div>
        <label htmlFor="confirm" className={label}>
          {t("confirmLabel")}
        </label>
        <input id="confirm" name="confirm" type="password" required maxLength={200} autoComplete="new-password" className={field} />
        {errors.confirm && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.confirm}</p>}
      </div>
    </>
  );
}
