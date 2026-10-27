"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordResetAction } from "@/lib/actions/password";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/merchant/form";

export function ForgotPasswordForm({ clinic }: { clinic: string | null }) {
  const t = useTranslations("auth.resetPassword");
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);
  if (state?.sent) {
    return (
      <p role="status" className="rounded-[10px] bg-primary-soft px-3 py-3 text-[13px] text-ink">
        {t("linkSent")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3.5">
      {clinic && <input type="hidden" name="clinic" value={clinic} />}
      <TextField label={t("emailLabel")} name="email" type="email" autoComplete="email" required />
      {state?.error && (
        <p role="alert" className="text-[12px] text-[var(--accent-red)]">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        {t("sendResetLink")}
      </Button>
    </form>
  );
}
