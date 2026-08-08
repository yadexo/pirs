"use client";

import { useActionState } from "react";
import { updateBusinessSettingsAction } from "@/lib/actions/settings";
import { Input, Label, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import type { TenantSettings } from "@prisma/client";

export function SettingsForm({ settings }: { settings: TenantSettings | null }) {
  const [state, formAction] = useActionState(updateBusinessSettingsAction, undefined);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div>
        <Label htmlFor="taxRatePercent">Sales tax rate (%)</Label>
        <Input
          id="taxRatePercent"
          name="taxRatePercent"
          type="number"
          step="0.01"
          min="0"
          max="30"
          defaultValue={settings ? settings.taxRateBasisPoints / 100 : 0}
          required
        />
      </div>
      <div>
        <Label htmlFor="appointmentCancellationHours">Appointment cancellation notice (hours)</Label>
        <Input
          id="appointmentCancellationHours"
          name="appointmentCancellationHours"
          type="number"
          min="0"
          max="168"
          defaultValue={settings?.appointmentCancellationHours ?? 24}
          required
        />
        <FieldHint>Customers must cancel or reschedule at least this many hours in advance.</FieldHint>
      </div>
      <div>
        <Label htmlFor="appointmentReminderHours">Reminder sent before appointment (hours)</Label>
        <Input
          id="appointmentReminderHours"
          name="appointmentReminderHours"
          type="number"
          min="0"
          max="168"
          defaultValue={settings?.appointmentReminderHours ?? 24}
          required
        />
      </div>
      <div>
        <Label htmlFor="membershipMaxPauseMonths">Default max membership pause (months)</Label>
        <Input
          id="membershipMaxPauseMonths"
          name="membershipMaxPauseMonths"
          type="number"
          min="1"
          max="12"
          defaultValue={settings?.membershipMaxPauseMonths ?? 2}
          required
        />
      </div>
      <div>
        <Label htmlFor="dataRetentionDays">Data retention period (days)</Label>
        <Input id="dataRetentionDays" name="dataRetentionDays" type="number" min="30" placeholder="Indefinite" defaultValue={settings?.dataRetentionDays ?? undefined} />
        <FieldHint>How long inactive customer records are retained before archival review.</FieldHint>
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">Save settings</SubmitButton>
    </form>
  );
}
