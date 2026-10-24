"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  regenerateBackupCodesAction,
  startTwoFactorSetupAction,
} from "@/lib/actions/two-factor";
import { Button } from "@/components/ui/button";

type Step = "idle" | "setup" | "backup-codes" | "disable";

export function TwoFactorManager({ enabled, remainingBackupCodes }: { enabled: boolean; remainingBackupCodes: number }) {
  const router = useRouter();
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
    setStep("idle");
    setSetupData(null);
    setBackupCodes(null);
    router.refresh();
  }

  if (step === "backup-codes" && backupCodes) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] font-medium text-ink">Save these backup codes somewhere safe.</p>
        <p className="text-[13px] text-ink-muted">
          Each works once, if you ever lose access to your authenticator app. This is the only time they&apos;re shown — write them down now.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-[10px] bg-app p-4 font-mono text-[13px]">
          {backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <Button onClick={finishSetup} className="w-full">
          I&apos;ve saved these — done
        </Button>
      </div>
    );
  }

  if (step === "setup" && setupData) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-ink-muted">Scan this with your authenticator app (Google Authenticator, 1Password, Authy, or similar), then enter the 6-digit code it shows.</p>
        <div className="flex justify-center rounded-[10px] bg-app p-4" dangerouslySetInnerHTML={{ __html: setupData.qrSvg }} />
        <details className="text-[12px] text-ink-muted">
          <summary className="cursor-pointer">Can&apos;t scan? Enter this key manually</summary>
          <p className="mt-1 break-all font-mono">{setupData.secret}</p>
        </details>
        <div>
          <label htmlFor="setup-code" className="mb-1.5 block text-[12px] font-medium">
            Code from your app
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
          Confirm and turn on
        </Button>
      </div>
    );
  }

  if (step === "disable") {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-ink-muted">Enter your password to turn off two-factor authentication.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setStep("idle")} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={disable} loading={pending} disabled={!password}>
            Turn off
          </Button>
        </div>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-4">
        <p className="rounded-[10px] bg-app px-3 py-2 text-[13px] text-ink">
          Two-factor authentication is on. {remainingBackupCodes} backup code{remainingBackupCodes === 1 ? "" : "s"} left.
        </p>
        {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
        <Button variant="outline" className="w-full" onClick={regenerateBackupCodes} loading={pending}>
          Generate new backup codes
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setStep("disable")}>
          Turn off two-factor authentication
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-[12px] text-[var(--accent-red)]">{error}</p>}
      <Button onClick={beginSetup} loading={pending} className="w-full">
        Set up two-factor authentication
      </Button>
    </div>
  );
}
