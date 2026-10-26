"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { resetTwoFactorByEmailAction } from "@/lib/actions/two-factor";
import { Button } from "@/components/ui/button";

/**
 * The one way back in when a clinic owner or another platform admin loses
 * their authenticator — their own portal is behind the same required-2FA
 * gate this is the escape hatch for, so this has to live somewhere they can
 * still reach without it: here, not in their own clinic's Team settings.
 */
export function TwoFactorReset() {
  const t = useTranslations("twoFactor.resetByEmail");
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const res = await resetTwoFactorByEmailAction(email);
    setPending(false);
    if ("error" in res) return setMessage({ kind: "error", text: res.error });
    setMessage({ kind: "ok", text: t("confirmed", { email: res.email }) });
    setEmail("");
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[220px]">
        <label htmlFor="reset-2fa-email" className="mb-1.5 block text-[12px] font-medium">
          {t("accountEmail")}
        </label>
        <input
          id="reset-2fa-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="owner@clinic.example"
          className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      <Button type="submit" loading={pending} disabled={!email}>
        {t("reset")}
      </Button>
      {message && (
        <p className={`w-full text-[12px] ${message.kind === "error" ? "text-[var(--accent-red)]" : "text-ink-muted"}`}>{message.text}</p>
      )}
    </form>
  );
}
