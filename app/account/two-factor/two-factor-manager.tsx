"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  regenerateBackupCodesAction,
  startTwoFactorSetupAction,
} from "@/lib/actions/two-factor";
import { Button } from "@/components/ui/button";

type Step = "idle" | "setup" | "backup-codes" | "disable";

export function TwoFactorManager({
  enabled,
  remainingBackupCodes,
  requiredForRole,
  continueUrl,
}: {
  enabled: boolean;
  remainingBackupCodes: number;
  /** Platform admin / clinic owner: turning this off is refused server-side too (lib/actions/two-factor.ts), this just keeps the dead-end button from showing. */
  requiredForRole: boolean;
  /** Where "done" goes — the page the gate originally sent this account here from, or its own landing page. */
  continueUrl: string;
}) {
  const router = useRouter();
  const t = useTranslations("twoFactor");
  const tc = useTranslations("common");
  const ta = useTranslations("auth");
  const [step, setStep] = React.useState<Step>("idle");
  const [setupData, setSetupData] = React.useState<{ otpauthUri: string; qrSvg: string; secret: string } | null>(null);
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function beginSetup() {
    setError(null);
    setPending(true);
    const res = await startTwoFactorSetupAction();
    setPending(false);
    if ("error" in res) return setError(res.error);
    setSetupData(res);
    setStep("setup");
  }

  async function confirm() {
    setError(null);
    setPending(true);
    const res = await confirmTwoFactorSetupAction(code);
    setPending(false);
    if ("error" in res) return setError(res.error);
    setBackupCodes(res.backupCodes);
    setStep("backup-codes");
    setCode("");
  }

  async function regenerateBackupCodes() {
    setError(null);
    setPending(true);
    const res = await regenerateBackupCodesAction();
    setPending(false);
    if ("error" in res) return setError(res.error);
    setBackupCodes(res.backupCodes);
    setStep("backup-codes");
  }

  async function disable() {
    if (requiredForRole) return; // belt and suspenders — the button isn't shown, and the action itself refuses this too
    setError(null);
    setPending(true);
    const res = await disableTwoFactorAction(password);
    setPending(false);
    if ("error" in res) return setError(res.error);
    setPassword("");
    setStep("idle");
    router.refresh();
  }

  function finishSetup() {
    // Straight to where they were headed — not a refresh that strands them
    // on this same page with nothing left to click.
    router.push(continueUrl);
  }

  if (step === "backup-codes" && backupCodes) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] font-medium text-ink">{t("saveBackupCodes")}</p>
        <p className="text-[13px] text-ink-muted">{t("backupCodesHint")}</p>
        <div className="grid grid-cols-2 gap-2 rounded-[10px] bg-app p-4 font-mono text-[13px]">
          {backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <Button onClick={finishSetup} className="w-full">
          {t("continueToDashboard")}
        </Button>
      </div>
    );
  }

  if (step === "setup" && setupData) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-ink-muted">{t("scanInstructions")}</p>
        <div className="flex justify-center rounded-[10px] bg-app p-4" dangerouslySetInnerHTML={{ __html: setupData.qrSvg }} />
        <details className="text-[12px] text-ink-muted">
          <summary className="cursor-pointer">{t("cantScan")}</summary>
          <p className="mt-1 break-all font-mono">{setupData.secret}</p>
        </details>
        <div>
          <label htmlFor="setup-code" className="mb-1.5 block text-[12px] font-medium">
            {t("codeFromApp")}
          </label>
          <input
            id="setup-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
        <Button onClick={confirm} loading={pending} disabled={code.length < 6} className="w-full">
          {t("confirmAndTurnOn")}
        </Button>
      </div>
    );
  }

  if (step === "disable") {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-ink-muted">{t("enterPasswordToTurnOff")}</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={ta("password")}
          autoComplete="current-password"
          className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setStep("idle")} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button className="flex-1" onClick={disable} loading={pending} disabled={!password}>
            {t("turnOff")}
          </Button>
        </div>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-4">
        <p className="rounded-[10px] bg-app px-3 py-2 text-[13px] text-ink">{t("on", { count: remainingBackupCodes })}</p>
        {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
        <Button variant="outline" className="w-full" onClick={regenerateBackupCodes} loading={pending}>
          {t("generateNewBackupCodes")}
        </Button>
        {requiredForRole ? (
          <p className="text-[12px] text-ink-faint">{t("requiredCantTurnOff")}</p>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setStep("disable")}>
            {t("turnOff")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
      <Button onClick={beginSetup} loading={pending} className="w-full">
        {t("setUp")}
      </Button>
    </div>
  );
}
